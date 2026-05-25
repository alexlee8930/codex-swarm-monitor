import { createReadStream, existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pickWorkspaceFolder } from "./folder-picker.mjs";
import { productMeta } from "./meta.mjs";
import { releaseReadiness } from "./release-readiness.mjs";
import { openStore } from "./store.mjs";
import { createSupportBundle } from "./support-bundle.mjs";
import { systemDoctor, systemReadiness } from "./system.mjs";
import { analyzeWorkspace, installWorkspace, uninstallWorkspace } from "./workspace.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const UI_ROOT = join(PACKAGE_ROOT, "apps/ui");

export function createSwarmServer({ store = openStore(), uiRoot = UI_ROOT, defaultWorkspace = process.cwd() } = {}) {
  const clients = new Set();

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const originPolicy = localOriginPolicy(req, url);
      if (!originPolicy.ok) {
        return sendJson(res, { ok: false, error: "origin_not_allowed" }, 403);
      }
      for (const [header, value] of Object.entries(originPolicy.headers)) {
        res.setHeader(header, value);
      }

      if (req.method === "OPTIONS") return sendOptions(res);
      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, { ok: true, service: "codex-swarm-monitor" });
      }
      if (req.method === "GET" && url.pathname === "/system") {
        return sendJson(res, await systemReadiness());
      }
      if (req.method === "GET" && url.pathname === "/version") {
        return sendJson(res, productMeta());
      }
      if (req.method === "GET" && url.pathname === "/release/readiness") {
        return sendJson(res, releaseReadiness(undefined, { inspectPublished: url.searchParams.get("remote") === "1" }));
      }
      if (req.method === "GET" && url.pathname === "/doctor") {
        return sendJson(res, await systemDoctor(url.searchParams.get("path") || defaultWorkspace));
      }
      if (req.method === "GET" && url.pathname === "/support/bundle") {
        return sendJson(res, await createSupportBundle({ store, workspace: selectedWorkspace(url) || defaultWorkspace }));
      }
      if (req.method === "GET" && url.pathname === "/state") {
        return sendJson(res, store.state({ workspace: selectedWorkspace(url) }));
      }
      if (req.method === "POST" && url.pathname === "/settings/retention") {
        const body = await readJson(req);
        const retention = store.setRetention(body.maxEvents);
        broadcast(clients, store);
        return sendJson(res, { ok: true, retention });
      }
      if (req.method === "GET" && url.pathname === "/workspace/current") {
        return sendJson(res, { path: defaultWorkspace });
      }
      if (req.method === "GET" && url.pathname === "/workspace/analyze") {
        return sendJson(res, await analyzeWorkspace(url.searchParams.get("path") || defaultWorkspace));
      }
      if (req.method === "POST" && url.pathname === "/workspace/pick") {
        const result = await pickWorkspaceFolder();
        return sendJson(res, result, result.ok ? 200 : 501);
      }
      if (req.method === "POST" && url.pathname === "/workspace/connect") {
        const body = await readJson(req);
        const eventBusUrl = body.eventBusUrl || `http://${req.headers.host || "127.0.0.1:4000"}`;
        return sendJson(res, await installWorkspace(body.path || defaultWorkspace, eventBusUrl, { includeMcp: body.includeMcp === true }));
      }
      if (req.method === "POST" && url.pathname === "/workspace/disconnect") {
        const body = await readJson(req);
        return sendJson(res, await uninstallWorkspace(body.path || defaultWorkspace));
      }
      if (req.method === "GET" && url.pathname === "/stream") {
        return handleStream(req, res, clients, store, selectedWorkspace(url));
      }
      if (req.method === "GET" && url.pathname === "/avatar") {
        return handleAvatar(url, res);
      }
      if (req.method === "POST" && url.pathname === "/events") {
        const body = await readJson(req);
        const event = store.append(body);
        broadcast(clients, store, event);
        return sendJson(res, { ok: true, event }, 201);
      }
      if (req.method === "DELETE" && url.pathname === "/events") {
        store.clear({ workspace: selectedWorkspace(url) });
        broadcast(clients, store);
        return sendJson(res, { ok: true });
      }
      if (req.method === "GET") {
        return serveStatic(url.pathname, res, uiRoot);
      }

      sendJson(res, { ok: false, error: "not_found" }, 404);
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, 500);
    }
  });

  server.on("close", () => {
    for (const client of clients) client.res.end();
    store.close();
  });

  return server;
}

function handleStream(req, res, clients, store, workspace) {
  res.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream"
  });
  const client = { res, workspace };
  clients.add(client);
  replayMissedEvents(req, res, store, workspace);
  writeSse(res, { type: "state", state: store.state({ workspace }) }, { id: store.latestId({ workspace }) });
  const keepAlive = setInterval(() => writeSse(res, { type: "heartbeat", timestamp: Date.now() }), 15000);
  res.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(client);
  });
}

function broadcast(clients, store, event) {
  for (const client of clients) {
    if (event && !matchesClientWorkspace(event, client.workspace)) continue;
    const message = { type: event ? "event" : "state", state: store.state({ workspace: client.workspace }) };
    if (event) message.event = event;
    writeSse(client.res, message, { id: event?.id || store.latestId({ workspace: client.workspace }) });
  }
}

function replayMissedEvents(req, res, store, workspace) {
  const lastEventId = Number(req.headers["last-event-id"] || 0);
  if (!Number.isFinite(lastEventId) || lastEventId <= 0) return;
  const state = store.state({ workspace });
  for (const event of store.after(lastEventId, 500, { workspace })) {
    writeSse(res, { type: "event", replay: true, state, event }, { id: event.id });
  }
}

function writeSse(res, message, options = {}) {
  const id = Number(options.id || 0);
  if (id > 0) res.write(`id: ${id}\n`);
  res.write(`data: ${JSON.stringify(message)}\n\n`);
}

function matchesClientWorkspace(event, workspace) {
  if (!workspace) return true;
  const root = normalizePath(workspace);
  const cwd = normalizePath(event.payload?.cwd || event.payload?.workspace || event.payload?.workspace_root || event.payload?.project_root);
  return Boolean(cwd && (cwd === root || cwd.startsWith(`${root}/`)));
}

function selectedWorkspace(url) {
  return url.searchParams.get("path") || url.searchParams.get("workspace") || "";
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(data));
}

function sendOptions(res) {
  res.writeHead(204);
  res.end();
}

function localOriginPolicy(req, url) {
  const origin = req.headers.origin;
  if (!origin) return { ok: true, headers: {} };
  if (!isLocalOrigin(origin)) return { ok: false, headers: {} };

  const requestOrigin = `${url.protocol}//${url.host}`;
  if (origin !== requestOrigin && !isLoopbackPair(origin, requestOrigin)) {
    return { ok: false, headers: {} };
  }

  return {
    ok: true,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      Vary: "Origin"
    }
  };
}

function isLoopbackPair(origin, requestOrigin) {
  const source = parseOrigin(origin);
  const target = parseOrigin(requestOrigin);
  if (!source || !target) return false;
  return source.protocol === target.protocol && source.port === target.port && isLoopbackHost(source.hostname) && isLoopbackHost(target.hostname);
}

function isLocalOrigin(origin) {
  const parsed = parseOrigin(origin);
  return Boolean(parsed && isLoopbackHost(parsed.hostname));
}

function parseOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return {
      hostname: parsed.hostname.toLowerCase(),
      port: parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
      protocol: parsed.protocol
    };
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function serveStatic(pathname, res, uiRoot) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(join(uiRoot, safePath));
  if (!filePath.startsWith(uiRoot) || !existsSync(filePath)) {
    return sendJson(res, { ok: false, error: "not_found" }, 404);
  }
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  createReadStream(filePath).pipe(res);
}

function handleAvatar(url, res) {
  const name = sanitizeAvatarPart(url.searchParams.get("name") || "Agent");
  const role = sanitizeAvatarPart(url.searchParams.get("role") || "Agent");
  const backgroundColor = sanitizeHexColor(url.searchParams.get("backgroundColor") || "b6e3f4");
  res.writeHead(200, { "Cache-Control": "public, max-age=604800", "Content-Type": "image/svg+xml" });
  res.end(notionAvatar(name, role, backgroundColor));
}

function sanitizeAvatarPart(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64) || "Agent";
}

function sanitizeHexColor(value) {
  const color = String(value || "").replace(/[^a-fA-F0-9]/g, "").slice(0, 6);
  return /^[a-fA-F0-9]{6}$/.test(color) ? color : "b6e3f4";
}

function notionAvatar(name, role, backgroundColor) {
  const hash = hashString(`${name}:${role}`);
  const accent = roleAccent(role);
  const line = "#202124";
  const paper = pick(["#fffdf8", "#fffaf5", "#fbfbfa", "#fffefb"], hash);
  const skin = pick(["#fff1df", "#ffe8d3", "#fff5e9", "#f8dfca"], Math.floor(hash / 3));
  const shirt = pick(["#ffffff", "#f6f8fa", "#fffaf0", "#f8fbff"], Math.floor(hash / 5));
  const ink = pick(["#1f2328", "#24292f", "#2d333b", "#202124"], Math.floor(hash / 7));
  const cheek = pick(["#f2a7a0", "#ef9aae", "#e7a27f", "#f0aaa2"], Math.floor(hash / 31));
  const hairVariant = Math.abs(hash) % 7;
  const outfitVariant = Math.floor(hash / 17) % 4;
  const eyeVariant = Math.floor(hash / 29) % 4;
  const noseVariant = Math.floor(hash / 19) % 3;
  const faceVariant = Math.floor(hash / 37) % 4;
  const mouth = [
    "M42.2 59.4c3.8 2.6 8.2 2.6 11.8 0",
    "M42.9 59.7c3.1 1.5 7.7 1.5 10.8 0",
    "M43.8 59.1c2.4 2.2 7.5 2.2 9.9 0",
    "M43.7 60.4h10.1"
  ][Math.floor(hash / 11) % 4];
  const hairShape = [
    `M28.8 39.2c2.4-12.8 10.3-19.6 23.1-19.6 12.7 0 20.6 6.9 22.8 19.7-5.7-3.8-13.3-5.8-22.6-5.8-9.4 0-17.2 1.9-23.3 5.7z`,
    `M29 39.8c3.1-12.8 11.4-19.4 23.1-19.4 11.2 0 18.9 6.4 22 18.5-8 .5-15.3-2-21.8-7.3-4.7 5.3-12.4 8-23.3 8.2z`,
    `M28.7 40.1c1.1-13.1 8.8-20 22.8-20 13.1 0 20.9 7 22.7 19.7-6.1-2.4-13.1-3.6-21-3.6-8.7 0-16.8 1.3-24.5 3.9z`,
    `M29 39.8c2.3-12.5 10.3-19.5 22-19.5 12 0 19.9 6.5 22.8 18.4-5.1 2.1-10.8 2.1-17.1.1-6-1.9-11-4.7-15-8.4-2.6 4.6-6.8 7.7-12.7 9.4z`,
    `M28.8 39.9c4.1-12 13.8-18.8 25.3-17.3 8.7 1.1 15.1 6.2 18.3 14.8-6.8 2.7-14.2 2-22.1-2.2-5.5 3.3-12.7 4.9-21.5 4.7z`,
    `M29.2 40c1.8-12 8.5-18.9 19.4-19.8 13.5-1.1 22 5.2 24.4 17.9-4.1 3-9.7 3.5-16.7 1.6-6.1-1.6-11-4.4-14.8-8.4-2.7 4.8-6.8 7.8-12.3 8.7z`,
    `M28.7 40c2.5-13.1 11.3-19.8 24-18.9 11.7.8 18.6 7.4 20.7 18.5-7.3-1-13.4-3.5-18.5-7.5-6.1 4.5-14.8 7.1-26.2 7.9z`
  ][hairVariant];
  const faceShape = [
    `M31.4 40.7c0-11.8 7.8-19.6 20.6-19.6s20.6 7.8 20.6 19.6v7.9c0 12.6-8.3 21.1-20.6 21.1s-20.6-8.5-20.6-21.1v-7.9z`,
    `M31.2 40.9c0-11.5 8-19.3 20.8-19.3 12.5 0 20.3 7.8 20.3 19.3v7.6c0 12-7.8 20.8-20.3 20.8-12.8 0-20.8-8.8-20.8-20.8v-7.6z`,
    `M31.8 41.3c0-12 7.6-19.5 20.1-19.5 12.4 0 20.2 7.5 20.2 19.5v7.2c0 12.5-7.9 20.8-20.2 20.8-12.4 0-20.1-8.3-20.1-20.8v-7.2z`,
    `M31.1 40.5c0-11.5 8.2-19.2 20.9-19.2 12.6 0 20.5 7.7 20.5 19.2v8c0 12.3-8.1 20.7-20.5 20.7-12.6 0-20.9-8.4-20.9-20.7v-8z`
  ][faceVariant];
  const glasses =
    Math.floor(hash / 23) % 4 === 0
      ? `<path d="M35.4 47h9.6m7 0h9.6M45 47c2 .7 4.9.7 7 0" fill="none" stroke="${line}" stroke-width="1.45" stroke-linecap="round" opacity=".78"/>
         <rect x="34.4" y="43.9" width="10.8" height="6.8" rx="3.4" fill="none" stroke="${line}" stroke-width="1.45" opacity=".82"/>
         <rect x="52" y="43.9" width="10.8" height="6.8" rx="3.4" fill="none" stroke="${line}" stroke-width="1.45" opacity=".82"/>`
      : "";
  const detailMarks =
    Math.floor(hash / 41) % 3 === 0
      ? `<circle cx="38.2" cy="54.2" r=".85" fill="${line}" opacity=".2"/><circle cx="61.2" cy="54.1" r=".85" fill="${line}" opacity=".2"/>`
      : Math.floor(hash / 41) % 3 === 1
        ? `<path d="M37.3 55.2c1.4-.9 3-.9 4.4 0M58.3 55.2c1.4-.9 3-.9 4.4 0" fill="none" stroke="${cheek}" stroke-width="1.25" stroke-linecap="round" opacity=".42"/>`
        : "";
  const brows = [
    `M36.4 42.4c2.4-.9 5.1-.9 7.6 0M56 42.4c2.4-.9 5.1-.9 7.6 0`,
    `M36.4 42.6c2.4-1.2 5.1-1.2 7.8-.3M55.8 42.3c2.8-.9 5.5-.8 7.8.4`,
    `M36.6 42.6h7.4M56.1 42.6h7.4`
  ][Math.floor(hash / 13) % 3];
  const eyes = [
    `<circle cx="40.8" cy="48.1" r="1.45" fill="${line}"/><circle cx="59.2" cy="48.1" r="1.45" fill="${line}"/>`,
    `<path d="M39.1 48.2c1.2-.7 2.5-.7 3.7 0M57.5 48.2c1.2-.7 2.5-.7 3.7 0" fill="none" stroke="${line}" stroke-width="1.6" stroke-linecap="round"/>`,
    `<circle cx="40.8" cy="48.1" r="1.35" fill="${line}"/><path d="M57.6 48.2c1.3-.7 2.7-.7 3.9 0" fill="none" stroke="${line}" stroke-width="1.6" stroke-linecap="round"/>`,
    `<path d="M39 47.9h3.8M57.4 47.9h3.8" fill="none" stroke="${line}" stroke-width="1.65" stroke-linecap="round"/>`
  ][eyeVariant];
  const nose = [
    `M50.7 49.2c-1 3-.4 5 1.5 5.9`,
    `M51.2 49.2c-1.2 2.8-1.1 4.8.5 5.8`,
    `M49.9 49.4c-.7 2.5-.3 4.1 1.3 5.3`
  ][noseVariant];
  const outfit = [
    `<path d="M19.5 92c3.8-14.6 14.3-22.4 28.8-22.4 14.4 0 25.1 7.8 28.8 22.4" fill="${shirt}" stroke="${line}" stroke-width="1.95" stroke-linejoin="round"/>
     <path d="M39.7 72.7c2.9 2.2 5.8 3.2 8.8 3.2 2.9 0 5.8-1 8.7-3.2" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" opacity=".58"/>`,
    `<path d="M19.5 92c3.7-14.3 14.4-22.1 29-22.1 14.8 0 25.3 7.8 28.6 22.1" fill="${shirt}" stroke="${line}" stroke-width="1.95" stroke-linejoin="round"/>
     <path d="M38 71.6l10.5 7.4L59 71.6M48.5 79V92" fill="none" stroke="${line}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".44"/>`,
    `<path d="M19.6 92c3.4-14.8 14-22.7 28.9-22.7 14.8 0 25.5 7.9 28.9 22.7" fill="${shirt}" stroke="${line}" stroke-width="1.95" stroke-linejoin="round"/>
     <path d="M35.7 78.2h26.7M39.6 83.5h18.3" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" opacity=".52"/>`,
    `<path d="M19.5 92c3.4-14.5 14.2-22.2 28.9-22.2 15.1 0 25.6 7.7 28.9 22.2" fill="${shirt}" stroke="${line}" stroke-width="1.95" stroke-linejoin="round"/>
     <path d="M37.7 72.8c5.1 2.5 16.6 2.5 21.6 0" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" opacity=".56"/>`
  ][outfitVariant];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${escapeXml(name)} avatar" data-avatar-style="notion-local-portrait" data-avatar-version="7">
    <title>${escapeXml(name)} ${escapeXml(role)}</title>
    <defs>
      <clipPath id="avatar-frame"><rect x="7" y="7" width="82" height="82" rx="18"/></clipPath>
    </defs>
    <rect width="96" height="96" rx="22" fill="#${backgroundColor}"/>
    <rect x="5.5" y="5.5" width="85" height="85" rx="21" fill="${paper}" opacity=".97"/>
    <path d="M17 18.8c14.9-5.1 45-5.3 62.2 1.1" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" opacity=".42"/>
    <g clip-path="url(#avatar-frame)">
      <path d="M17.5 73.8c15.8 4.1 42.1 3.8 61.2-1.1" fill="none" stroke="${accent}" stroke-width="9" stroke-linecap="round" opacity=".08"/>
      <circle cx="74" cy="24.2" r="3.2" fill="${accent}" opacity=".16"/>
      <path d="M71.3 24.2h5.4" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" opacity=".48"/>
      ${outfit}
      <path d="M40 63.3c3.8 3 13.9 3 17.7 0v7.3c-4.8 2.6-12.9 2.6-17.7 0v-7.3z" fill="${skin}" stroke="${line}" stroke-width="1.85" stroke-linejoin="round"/>
      <path d="M31.4 48c-2.7.4-4.7 2.5-4.7 5.2s2 4.8 4.7 5.2M68.6 48c2.7.4 4.7 2.5 4.7 5.2s-2 4.8-4.7 5.2" fill="${skin}" stroke="${line}" stroke-width="1.85" stroke-linecap="round"/>
      <path d="${faceShape}" fill="${skin}" stroke="${line}" stroke-width="2.05"/>
      <path d="${hairShape}" fill="${ink}" stroke="${line}" stroke-width="2.1" stroke-linejoin="round"/>
      <path d="${brows}" fill="none" stroke="${line}" stroke-width="1.5" stroke-linecap="round" opacity=".48"/>
      ${eyes}
      ${glasses}
      ${detailMarks}
      <path d="${nose}" fill="none" stroke="${line}" stroke-width="1.35" stroke-linecap="round" opacity=".66"/>
      <path d="${mouth}" fill="none" stroke="${line}" stroke-width="1.75" stroke-linecap="round"/>
    </g>
    <rect x="7" y="7" width="82" height="82" rx="18" fill="none" stroke="${line}" stroke-width="1.05" opacity=".14"/>
    <path d="M64.8 83.2h12.2" stroke="${accent}" stroke-width="2.25" stroke-linecap="round" opacity=".62"/>
  </svg>`;
}

function pick(values, hash) {
  return values[Math.abs(hash) % values.length];
}

function roleAccent(role) {
  const accents = {
    Orchestrator: "#1f883d",
    Planner: "#0969da",
    Explorer: "#0a7f72",
    Builder: "#8250df",
    Reviewer: "#cf222e",
    Tester: "#57606a",
    Leader: "#1f883d"
  };
  return accents[role] || "#0969da";
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
    return entities[char];
  });
}

function contentType(filePath) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  return types[extname(filePath)] || "application/octet-stream";
}
