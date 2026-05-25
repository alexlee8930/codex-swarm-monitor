#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-realtime-"));
const workspace = join(temp, "workspace");
let child;

try {
  await mkdir(workspace, { recursive: true });
  writeFileSync(join(workspace, "AGENTS.md"), "# Agents\n\nRealtime smoke workspace.\n");
  writeFileSync(join(workspace, "RALPH.md"), "# Task\nVerify realtime smoke.\n\n# Success Criteria\n- [SC-1] live event visible\n");

  const boot = await startMonitor(workspace, join(temp, "events.sqlite"));
  child = boot.child;
  const base = boot.url;
  const workspaceParam = encodeURIComponent(workspace);

  await fetchOk(`${base}/events?path=${workspaceParam}`, { method: "DELETE" });
  const emptyState = await fetchJson(`${base}/state?path=${workspaceParam}`);
  assert.equal(emptyState.agents.length, 0);
  assert.equal(emptyState.metrics.storedEvents, 0);

  const abort = new AbortController();
  const liveMessagePromise = readSseUntil(
    `${base}/stream?path=${workspaceParam}`,
    (message) => message.type === "event" && message.event?.agent_id === "explorer-live01" && message.state?.agents?.length === 1,
    abort.signal
  );

  const postedAt = Date.now();
  const event = await postJson(`${base}/events`, {
    type: "agent_spawn",
    agent_id: "explorer-live01",
    role: "Explorer",
    task: "Inspect live workspace event flow",
    parent: "main",
    cwd: workspace
  });
  assert.equal(event.ok, true);

  const liveMessage = await liveMessagePromise;
  const streamLatencyMs = Date.now() - postedAt;
  abort.abort();
  assert.ok(streamLatencyMs < 1000, `live SSE event should arrive in under 1000ms, got ${streamLatencyMs}ms`);
  assert.ok(liveMessage.sseId > 0, "live SSE message must include an event id");
  assert.equal(liveMessage.event.type, "agent_spawn");
  assert.equal(liveMessage.state.agents[0].id, "explorer-live01");
  assert.match(liveMessage.state.agents[0].avatar, /\/avatar\?name=Explorer&role=Explorer&backgroundColor=ffd5dc&v=7/);

  await postJson(`${base}/events`, {
    type: "file_read",
    agent_id: "explorer-live01",
    path: "src/live.md",
    tool: "read",
    cwd: workspace
  });

  const finalState = await fetchJson(`${base}/state?path=${workspaceParam}`);
  assert.equal(finalState.metrics.storedEvents, 2);
  assert.equal(finalState.agents[0].id, "explorer-live01");
  assert.equal(finalState.agents[0].currentFile, "src/live.md");
  assert.equal(finalState.files[0].path, "src/live.md");
  assert.doesNotMatch(JSON.stringify(finalState), /mockAgents|demoAgents|seedEvents|api\.dicebear/i);

  const chrome = findChrome();
  if (chrome) {
    const dom = await runChromeDom(chrome, `${base}/?e2e_snapshot=1`, join(temp, "chrome-dom"));
    assert.match(dom, /agent-card active|agent-card working/);
    assert.match(dom, /Explorer/);
    assert.match(dom, /Inspect live workspace event flow/);
    assert.match(dom, /src\/live\.md/);
    assert.match(dom, /\/avatar\?name=Explorer&amp;role=Explorer&amp;backgroundColor=ffd5dc&amp;v=7/);
    assert.match(dom, /Realtime Pipeline/);
    assert.match(dom, /Event freshness/);
    assert.match(dom, /old/);
    assert.doesNotMatch(dom, /No live agents yet/);
    assert.doesNotMatch(dom, /mockAgents|demoAgents|seedEvents|api\.dicebear/i);
  }

  console.log("realtime smoke ok");
} finally {
  if (child) child.kill("SIGTERM");
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function startMonitor(targetWorkspace, dbPath) {
  return new Promise((resolveStart, rejectStart) => {
    const proc = spawn(process.execPath, ["apps/backend/src/index.mjs", "--workspace", targetWorkspace, "--port", "0", "--connect"], {
      cwd: root,
      env: { ...process.env, CODEX_SWARM_DB: dbPath },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectStart(error);
      else resolveStart(value);
    };
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      finish(new Error(`Timed out waiting for monitor URL: ${stdout}${stderr}`));
    }, 5000);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) finish(null, { child: proc, url: match[0] });
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => finish(error));
    proc.on("close", (code) => {
      if (!stdout.match(/http:\/\/127\.0\.0\.1:\d+/)) {
        finish(new Error(`Monitor exited ${code}: ${stderr}`));
      }
    });
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  assert.equal(response.ok, true, `${url} should return 2xx`);
  return response.json();
}

async function fetchOk(url, options) {
  const response = await fetch(url, options);
  assert.equal(response.ok, true, `${url} should return 2xx`);
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function readSseUntil(url, predicate, signal) {
  const response = await fetch(url, { signal });
  assert.equal(response.ok, true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeout = AbortSignal.timeout(5000);
  timeout.addEventListener("abort", () => reader.cancel().catch(() => {}));

  while (!timeout.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const idLine = part.split("\n").find((item) => item.startsWith("id: "));
      const line = part.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const message = JSON.parse(line.slice(6));
      if (idLine) message.sseId = Number(idLine.slice(4));
      if (predicate(message)) return message;
    }
  }
  throw new Error("Timed out waiting for realtime SSE message");
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function runChromeDom(chrome, url, userDataDir) {
  return new Promise((resolveRun, rejectRun) => {
    const proc = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-sandbox",
      "--virtual-time-budget=4000",
      `--user-data-dir=${userDataDir}`,
      "--dump-dom",
      url
    ]);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectRun(error);
      else resolveRun(stdout);
    };
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      if (stdout.includes("agent-card") && stdout.includes("Inspect live workspace event flow")) finish();
      else finish(new Error(`Chrome DOM timed out: ${stderr}`));
    }, 9000);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => finish(error));
    proc.on("close", (code) => {
      if (code === 0 || stdout.includes("Inspect live workspace event flow")) finish();
      else finish(new Error(`Chrome DOM exited ${code}: ${stderr}`));
    });
  });
}
