#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { productMeta } from "./meta.mjs";
import { createSwarmServer } from "./server.mjs";
import { openStore } from "./store.mjs";
import { createSupportBundle } from "./support-bundle.mjs";
import { systemDoctor } from "./system.mjs";
import { installWorkspace } from "./workspace.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}
if (options.version) {
  const meta = productMeta();
  if (options.json) console.log(JSON.stringify(meta, null, 2));
  else console.log(`${meta.name} ${meta.version} (${meta.distribution}, ${meta.node})`);
  process.exit(0);
}

const preferredPort = Number(options.port || process.env.PORT || process.env.CODEX_SWARM_PORT || 4000);
const host = options.host || process.env.HOST || "127.0.0.1";
const defaultWorkspace = resolve(String(options.workspace || process.cwd()));

if (options.doctor) {
  const report = await systemDoctor(defaultWorkspace);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printDoctor(report);
  process.exit(report.ok ? 0 : 1);
}

if (options.support) {
  const store = openStore();
  try {
    const bundle = await createSupportBundle({ store, workspace: defaultWorkspace });
    console.log(JSON.stringify(bundle, null, 2));
  } finally {
    store.close();
  }
  process.exit(0);
}

const server = createSwarmServer({ defaultWorkspace });

await listenWithFallback(server, { host, preferredPort });

const address = server.address();
const url = `http://${host}:${address.port}`;
const connectedWorkspace = options.connect
  ? await installWorkspace(defaultWorkspace, url, { includeMcp: options.includeMcp === true })
  : null;

console.log(`Codex Swarm Monitor running at ${url}`);
console.log(`Workspace: ${defaultWorkspace}`);
if (connectedWorkspace) {
  console.log(`Hooks installed: ${connectedWorkspace.harness.hooks.swarmEvents.length}/7 lifecycle events`);
  console.log("Open the URL, then run Codex in that folder.");
} else {
  console.log("Open the URL, analyze a folder, click Install hooks, then run Codex in that folder.");
}

if (options.open) openBrowser(url);

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

function parseArgs(args) {
  const output = { open: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") output.help = true;
    else if (arg === "--version" || arg === "-v") output.version = true;
    else if (arg === "--doctor") output.doctor = true;
    else if (arg === "--support") output.support = true;
    else if (arg === "--json") output.json = true;
    else if (arg === "--open") output.open = true;
    else if (arg === "--connect") output.connect = true;
    else if (arg === "--include-mcp") output.includeMcp = true;
    else if (arg === "--workspace" || arg === "-w") output.workspace = args[++index];
    else if (arg.startsWith("--workspace=")) output.workspace = arg.split("=").slice(1).join("=");
    else if (arg === "--port" || arg === "-p") output.port = args[++index];
    else if (arg.startsWith("--port=")) output.port = arg.split("=").slice(1).join("=");
    else if (arg === "--host") output.host = args[++index];
    else if (arg.startsWith("--host=")) output.host = arg.split("=").slice(1).join("=");
  }
  return output;
}

function listenWithFallback(targetServer, { host, preferredPort }) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      targetServer.off("error", onError);
      if (error.code === "EADDRINUSE" && preferredPort !== 0) {
        targetServer.listen(0, host, resolveListen);
        return;
      }
      rejectListen(error);
    };
    targetServer.once("error", onError);
    targetServer.listen(preferredPort, host, () => {
      targetServer.off("error", onError);
      resolveListen();
    });
  });
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function printHelp() {
  console.log(`Codex Swarm Monitor

Usage:
  codex-swarm-monitor [--workspace <path>] [--port <number>] [--host <host>] [--open] [--connect]

Options:
  -w, --workspace <path>  Folder to analyze by default. Defaults to current directory.
  -p, --port <number>    Port to bind. Defaults to 4000; falls back to a free port on conflict.
      --host <host>      Host to bind. Defaults to 127.0.0.1.
      --open             Open the app in the default browser.
      --connect          Install project-local Codex hooks for the workspace at startup.
      --include-mcp      Also add the optional bundled agent_spawner MCP server with --connect.
      --doctor           Run preflight checks and exit.
      --support          Emit a local support bundle JSON and exit.
      --json             Emit JSON with --doctor or --version.
  -v, --version          Show package and runtime version.
  -h, --help             Show this help.
`);
}

function printDoctor(report) {
  console.log(`Codex Swarm Monitor doctor for ${report.workspace}`);
  for (const item of report.checks) {
    const mark = item.ok ? "ok" : item.optional ? "skip" : "fail";
    console.log(`[${mark}] ${item.id}: ${item.summary}`);
    if (!item.ok && item.remediation) console.log(`      ${item.remediation}`);
  }
}
