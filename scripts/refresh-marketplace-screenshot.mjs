#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workspace = resolve(process.argv[2] || root);
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-marketplace-screenshot-"));
const screenshotPath = join(root, "plugins/codex-swarm-monitor/assets/screenshots/dashboard-desktop.png");
const capturePath = join(temp, "dashboard-desktop.png");
let child;

try {
  const chrome = findChrome();
  assert.ok(chrome, "Chrome or Chromium is required to refresh the marketplace screenshot");

  const boot = await startMonitor(workspace);
  child = boot.child;
  const base = boot.url;
  const workspaceParam = encodeURIComponent(workspace);

  await fetchOk(`${base}/events?path=${workspaceParam}`, { method: "DELETE" });
  const emptyState = await fetchJson(`${base}/state?path=${workspaceParam}`);
  assert.equal(emptyState.agents.length, 0, "marketplace screenshot must start with no live agents");
  assert.equal(emptyState.metrics.storedEvents, 0, "marketplace screenshot must not include historical events");

  const url = `${base}/?e2e_snapshot=1`;
  const dom = await runChromeDom(chrome, url, join(temp, "chrome-dom"));
  assertMarketplaceDom(dom);

  await runChromeScreenshot(chrome, url, capturePath, join(temp, "chrome-shot"), {
    width: 1440,
    height: 960,
    minBytes: 100_000
  });
  assertPng(capturePath, { width: 1440, height: 960, minBytes: 100_000 });
  copyFileSync(capturePath, screenshotPath);
  assertPng(screenshotPath, { width: 1440, height: 960, minBytes: 100_000 });

  console.log(JSON.stringify({
    ok: true,
    workspace,
    screenshot: "plugins/codex-swarm-monitor/assets/screenshots/dashboard-desktop.png",
    bytes: statSync(screenshotPath).size
  }, null, 2));
} finally {
  if (child) child.kill("SIGTERM");
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function startMonitor(targetWorkspace) {
  return new Promise((resolveStart, rejectStart) => {
    const proc = spawn(process.execPath, ["apps/backend/src/index.mjs", "--workspace", targetWorkspace, "--port", "0", "--connect"], {
      cwd: root,
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
      if (stdout.includes("repo-context-item") && stdout.includes("stream-status-card")) finish();
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
      if (code === 0 || stdout.includes("repo-context-item")) finish();
      else finish(new Error(`Chrome DOM exited ${code}: ${stderr}`));
    });
  });
}

function runChromeScreenshot(chrome, url, screenshot, userDataDir, viewport) {
  return new Promise((resolveRun, rejectRun) => {
    const proc = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-sandbox",
      "--virtual-time-budget=4000",
      `--user-data-dir=${userDataDir}`,
      `--window-size=${viewport.width},${viewport.height}`,
      `--screenshot=${screenshot}`,
      url
    ]);
    let stderr = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectRun(error);
      else resolveRun();
    };
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      if (existsSync(screenshot) && statSync(screenshot).size > viewport.minBytes) finish();
      else finish(new Error(`Chrome screenshot timed out: ${stderr}`));
    }, 9000);
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => finish(error));
    proc.on("close", (code) => {
      if (code === 0 || (existsSync(screenshot) && statSync(screenshot).size > viewport.minBytes)) finish();
      else finish(new Error(`Chrome screenshot exited ${code}: ${stderr}`));
    });
  });
}

function assertMarketplaceDom(dom) {
  for (const required of [
    /Codex Swarm/,
    /codex_dashboard/,
    /Repository intelligence/,
    /Ralph loop map/,
    /Acceptance loop/,
    /Verification commands/,
    /Realtime Pipeline/,
    /Event freshness/,
    /Replay recovery/,
    /Only Codex is required for end users/,
    /Project-local hook/,
    /Agent cards appear only after real Codex hook or MCP events|Agent cards and logs come from actual hook payloads/,
    /Finish publishing/,
    /No demo events/,
    /Ready for real Codex activity/,
    /Event stream armed/,
    /Under 1000ms smoke tested/,
    /copy-inline-codex/,
    /Mock data[\s\S]{0,80}disabled/,
    /Local Notion-style avatars/,
    /Last-Event-ID ready/
  ]) {
    assert.match(dom, required);
  }
  for (const forbidden of [
    /swarm-ui-mockup|ralph-hierarchy/i,
    /mockAgents|demoAgents|seedEvents|loadDemo/i,
    /api\.dicebear|dicebear/i,
    /Sisyphus|Athena|Hermes|Hephaestus|Argus|Themis/
  ]) {
    assert.doesNotMatch(dom, forbidden);
  }
}

function assertPng(path, viewport) {
  const file = readFileSync(path);
  assert.ok(file.length > viewport.minBytes, "marketplace screenshot should not be blank");
  assert.equal(file.readUInt32BE(0), 0x89504e47, "marketplace screenshot must be PNG");
  assert.equal(file.readUInt32BE(16), viewport.width, "marketplace screenshot width");
  assert.equal(file.readUInt32BE(20), viewport.height, "marketplace screenshot height");
}
