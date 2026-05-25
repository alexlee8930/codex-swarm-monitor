#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-fresh-"));
const manifest = JSON.parse(execFileSync(process.execPath, ["scripts/build-standalone.mjs"], { cwd: root, encoding: "utf8" }));
const bundleRoot = join(root, "dist", manifest.bundle);
const prefix = join(temp, "home", ".local");
const workspace = join(temp, "workspace");
const dbPath = join(temp, "runtime.sqlite");
let server;

try {
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "AGENTS.md"), "# Fresh Workspace\n");

  const launcher = installBundle(bundleRoot, prefix);
  rmSync(bundleRoot, { recursive: true, force: true });
  assert.equal(existsSync(bundleRoot), false, "fresh install must not depend on the extracted bundle folder");
  assert.match(execFileSync(launcher, ["--help"], { encoding: "utf8", shell: process.platform === "win32" }), /--workspace <path>/);

  const boot = await startInstalled(launcher, workspace, dbPath);
  server = boot.child;
  const base = boot.url;

  const [health, system, initialState] = await Promise.all([
    fetchJson(`${base}/health`),
    fetchJson(`${base}/system`),
    fetchJson(`${base}/state`)
  ]);
  assert.equal(health.ok, true);
  assert.equal(system.runtime.ok, true);
  assert.equal(typeof system.codex.ok, "boolean");
  assert.equal(initialState.metrics.totalEvents, 0, "fresh monitor state must start without mock data");

  const connected = await fetchJson(`${base}/workspace/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: workspace, eventBusUrl: base })
  });
  assert.equal(connected.install.configured, true);
  assert.equal(connected.trust.hookPath, join(workspace, ".codex/codex-swarm-monitor/hook.mjs"));

  const hookCommand = readHookCommand(workspace, "PostToolUse");
  assert.doesNotMatch(hookCommand, new RegExp(escapeRegex(root)), "installed hook command must not depend on source checkout");
  assert.match(hookCommand, /codex-swarm-monitor[\\/]hook\.mjs/);

  await runHook(hookCommand, workspace, {
    hook_event_name: "PostToolUse",
    tool_name: "shell",
    tool_input: { command: "sed -n '1,20p' AGENTS.md" },
    cwd: workspace
  });

  const state = await eventually(async () => fetchJson(`${base}/state`), (value) => value.metrics.totalEvents === 1);
  assert.equal(state.files[0].path, "AGENTS.md");
  assert.equal(state.agents[0].id, "main");
} finally {
  if (server) server.kill("SIGTERM");
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function installBundle(bundleRoot, prefix) {
  if (process.platform === "win32") {
    const installer = join(bundleRoot, "install.ps1");
    assert.equal(existsSync(installer), true);
    execFileSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", installer], {
      env: { ...process.env, PREFIX: prefix },
      stdio: "pipe"
    });
    return join(prefix, "bin", "codex-swarm-monitor.cmd");
  }

  const installer = join(bundleRoot, "install.sh");
  assert.equal(existsSync(installer), true);
  execFileSync(installer, { env: { ...process.env, PREFIX: prefix }, stdio: "pipe" });
  return join(prefix, "bin", "codex-swarm-monitor");
}

function startInstalled(launcher, workspace, dbPath) {
  return new Promise((resolveStart, rejectStart) => {
    const child = spawn(launcher, ["--workspace", workspace, "--port", "0"], {
      cwd: workspace,
      env: {
        ...process.env,
        CODEX_SWARM_DB: dbPath,
        HOME: join(workspace, ".home")
      },
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectStart(new Error(`Timed out waiting for installed monitor URL: ${stdout}${stderr}`));
    }, 6000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolveStart({ child, url: match[0] });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectStart(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!stdout.match(/http:\/\/127\.0\.0\.1:\d+/)) {
        rejectStart(new Error(`Installed monitor exited ${code}: ${stderr}`));
      }
    });
  });
}

function readHookCommand(workspace, eventName) {
  const hooks = JSON.parse(readFileSync(join(workspace, ".codex/hooks.json"), "utf8"));
  const command = hooks.hooks?.[eventName]?.[0]?.hooks?.find((hook) => String(hook.command || "").includes("codex-swarm-monitor"))?.command;
  assert.equal(typeof command, "string");
  return command;
}

function runHook(command, cwd, payload) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.platform === "win32" ? "cmd" : "sh", [process.platform === "win32" ? "/c" : "-c", command], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`Hook ${basename(command)} exited ${code}: ${stderr}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  assert.equal(response.ok, true, `${url} should return 2xx`);
  return response.json();
}

async function eventually(producer, predicate) {
  const started = Date.now();
  let last;
  while (Date.now() - started < 3000) {
    last = await producer();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Condition not met within timeout: ${JSON.stringify(last)}`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
