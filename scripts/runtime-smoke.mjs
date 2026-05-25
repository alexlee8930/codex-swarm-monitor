#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-runtime-"));
let child;

try {
  const boot = await startMonitor(root);
  child = boot.child;
  const base = boot.url;

  const [health, version, release, current, workspace, html] = await Promise.all([
    fetchJson(`${base}/health`),
    fetchJson(`${base}/version`),
    fetchJson(`${base}/release/readiness`),
    fetchJson(`${base}/workspace/current`),
    fetchJson(`${base}/workspace/analyze?path=${encodeURIComponent(root)}`),
    fetchText(base)
  ]);
  const doctor = await fetchJson(`${base}/doctor?path=${encodeURIComponent(root)}`);
  const support = await fetchJson(`${base}/support/bundle?path=${encodeURIComponent(root)}`);

  assert.equal(health.ok, true);
  assert.equal(version.name, "codex-swarm-monitor");
  assert.equal(version.distribution, "source");
  assert.equal(version.release.mockData, false);
  assert.match(version.release.endUserPath, /Codex plugin/);
  assert.deepEqual(version.release.userPrerequisites, ["Codex"]);
  assert.equal(version.release.endUsersNeedNode, false);
  assert.equal(version.release.endUsersNeedNpm, false);
  assert.equal(version.release.endUsersNeedOmx, false);
  assert.equal(release.tag, "v0.1.0");
  assert.ok(release.checks.some((item) => item.id === "standalone-archives"));
  assert.ok(release.checks.every((item) => item.ok || item.remediation));
  assert.ok(release.plan.some((item) => item.id === "verify-source" && item.command === "npm run verify"));
  assert.equal(current.path, root);
  assert.equal(workspace.name, basename(root));
  assert.equal(workspace.install.configured, true);
  assert.ok(workspace.harness.ralph.successCriteria.length > 0, "workspace analysis must extract Ralph success criteria");
  assert.ok(workspace.harness.ralph.tasks.length > 0, "workspace analysis must extract implementation loop tasks");
  assert.ok(workspace.harness.ralph.verificationCommands.length > 0, "workspace analysis must extract verification commands");
  assert.ok(workspace.harness.stages.some((stage) => stage.id === "acceptance-loop" && stage.state === "active"));
  assert.ok(doctor.checks.some((item) => item.id === "runtime" && item.ok));
  assert.ok(doctor.readiness.runtime.label.includes("runtime"));
  assert.ok(doctor.checks.some((item) => item.id === "workspace-readable" && item.ok));
  assert.equal(support.service, "codex-swarm-monitor");
  assert.equal(support.privacy.syntheticEvents, false);
  assert.equal(support.workspace.root, root);
  assert.ok(support.release.plan.some((item) => item.id === "verify-source"));
  assert.match(html, /Codex Swarm/);
  assert.match(html, /workspace-form/);
  assert.match(html, /browse-workspace/);
  assert.match(html, /disconnect-workspace/);
  assert.match(html, /quickstart-panel/);
  assert.match(html, /quickstart-list/);
  assert.match(html, /trust-panel/);
  assert.match(html, /trust-list/);
  assert.match(html, /launch-command/);
  assert.match(html, /copy-launch/);
  assert.match(html, /codex-command/);
  assert.match(html, /copy-codex/);
  assert.match(html, /copy-icon/);
  assert.match(html, /sr-only/);
  assert.match(html, /lifecycle-strip/);
  assert.match(html, /swarm-graph/);
  assert.match(html, /doctor-list/);
  assert.match(html, /ops-panel/);
  assert.match(html, /ops-list/);
  assert.match(html, /pipeline-panel/);
  assert.match(html, /pipeline-list/);
  assert.match(html, /release-plan/);
  assert.match(html, /download-support/);
  assert.match(html, /retention-form/);
  assert.match(html, /retention-max/);
  assert.match(html, /repo-context/);
  assert.match(html, /repo-command-strip/);
  assert.match(html, /production-workspace-layout/);
  assert.match(html, /canvas-proof-strip/);
  assert.match(html, /Native Codex hooks/);
  assert.match(html, /Workspace-scoped SSE/);
  assert.match(html, /No demo events/);
  assert.match(html, /stream-detail/);
  assert.match(html, /event-stream-state/);

  await fetch(`${base}/events`, { method: "DELETE" });
  const retentionResponse = await fetch(`${base}/settings/retention`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxEvents: 25000 })
  });
  assert.equal(retentionResponse.ok, true);
  const emptyState = await fetchJson(`${base}/state`);
  assert.equal(emptyState.metrics.totalEvents, 0);
  assert.equal(emptyState.metrics.storedEvents, 0);
  assert.equal(emptyState.retention.maxEvents, 25000);
  assert.equal(emptyState.agents.length, 0);
  assert.equal(emptyState.edges.length, 0);

  const chrome = findChrome();
  if (chrome) {
    const renderedDom = await runChromeDom(chrome, `${base}/?e2e_snapshot=1`, join(temp, "chrome-dom"));
    assert.match(renderedDom, /repo-context-item/);
    assert.match(renderedDom, /Acceptance loop/);
    assert.match(renderedDom, /Success criteria/);
    assert.match(renderedDom, /Implementation loop/);
    assert.match(renderedDom, /Verification commands/);
    assert.match(renderedDom, /npm test/);
    assert.match(renderedDom, /--connect --open/);
    assert.match(renderedDom, /codex_dashboard[\s\S]{0,120}codex/);
    assert.match(renderedDom, /User prerequisites/);
    assert.match(renderedDom, /Bundled runtime/);
    assert.match(renderedDom, /Realtime Pipeline/);
    assert.match(renderedDom, /Event freshness/);
    assert.match(renderedDom, /Native Codex hooks/);
    assert.match(renderedDom, /Workspace-scoped SSE/);
    assert.match(renderedDom, /No demo events/);
    assert.match(renderedDom, /Hook target/);
    assert.match(renderedDom, /Replay recovery/);
    assert.match(renderedDom, /Last-Event-ID ready/);
    assert.match(renderedDom, /Connected to this monitor/);
    assert.match(renderedDom, /Only Codex is required for end users/);
    assert.match(renderedDom, /Project-local hook/);
    assert.match(renderedDom, /Agent cards appear only after real Codex hook or MCP events|Agent cards and logs come from actual hook payloads/);
    assert.match(renderedDom, /Finish publishing/);
    assert.doesNotMatch(renderedDom, /Hook target changed/);
    assert.match(renderedDom, /Event ingest/);
    assert.match(renderedDom, /waiting for real Codex activity/);
    assert.match(renderedDom, /Release gate/);
    assert.match(renderedDom, /Release checklist/);
    assert.match(renderedDom, /gh release create v0\.1\.0/);
    assert.match(renderedDom, /Download support bundle/);
    assert.match(renderedDom, /Repository intelligence/);
    assert.match(renderedDom, /repo-tabs/);
    assert.match(renderedDom, /stream-status-card live/);
    assert.match(renderedDom, /last message/);
    assert.doesNotMatch(renderedDom, /just now ago/);
    assert.match(renderedDom, /Ready for real Codex activity/);
    assert.match(renderedDom, /Event stream armed/);
    assert.match(renderedDom, /Under 1000ms smoke tested/);
    assert.match(renderedDom, /copy-inline-codex/);
    assert.match(renderedDom, /copy-icon/);
    assert.doesNotMatch(renderedDom, /No live agents yet/);
    assert.doesNotMatch(renderedDom, /mockAgents|demoAgents|seedEvents|api\.dicebear/i);

    const viewports = [
      { name: "desktop", width: 1440, height: 900, minBytes: 30000 },
      { name: "tablet", width: 1024, height: 900, minBytes: 26000 },
      { name: "mobile", width: 390, height: 900, minBytes: 16000 }
    ];
    for (const viewport of viewports) {
      const screenshot = join(temp, `${viewport.name}.png`);
      await runChrome(chrome, base, screenshot, join(temp, `chrome-${viewport.name}`), viewport);
      assertPng(screenshot, viewport);
  }
}
} finally {
  if (child) child.kill("SIGTERM");
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function startMonitor(workspace) {
  return new Promise((resolveStart, rejectStart) => {
    const proc = spawn(process.execPath, ["apps/backend/src/index.mjs", "--workspace", workspace, "--port", "0", "--connect"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      rejectStart(new Error(`Timed out waiting for monitor URL: ${stdout}${stderr}`));
    }, 5000);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolveStart({ child: proc, url: match[0] });
      }
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      rejectStart(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (!stdout.match(/http:\/\/127\.0\.0\.1:\d+/)) {
        rejectStart(new Error(`Monitor exited ${code}: ${stderr}`));
      }
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} should return 2xx`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} should return 2xx`);
  return response.text();
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

function runChrome(chrome, url, screenshot, userDataDir, viewport) {
  return new Promise((resolveRun, rejectRun) => {
    const proc = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
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
      else finish(new Error(`Chrome timed out: ${stderr}`));
    }, 8000);
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      finish(error);
    });
    proc.on("close", (code) => {
      if (code === 0 || (existsSync(screenshot) && statSync(screenshot).size > viewport.minBytes)) finish();
      else finish(new Error(`Chrome exited ${code}: ${stderr}`));
    });
  });
}

function runChromeDom(chrome, url, userDataDir) {
  return new Promise((resolveRun, rejectRun) => {
    const proc = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--virtual-time-budget=3000",
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
    }, 8000);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      finish(error);
    });
    proc.on("close", (code) => {
      if (code === 0 || stdout.includes("repo-context-item")) finish();
      else finish(new Error(`Chrome DOM exited ${code}: ${stderr}`));
    });
  });
}

function assertPng(path, viewport) {
  const file = readFileSync(path);
  assert.ok(file.length > viewport.minBytes, `${viewport.name} screenshot should not be blank`);
  assert.equal(file.readUInt32BE(0), 0x89504e47, `${viewport.name} screenshot must be PNG`);
  assert.equal(file.readUInt32BE(16), viewport.width, `${viewport.name} screenshot width`);
  assert.equal(file.readUInt32BE(20), viewport.height, `${viewport.name} screenshot height`);
}
