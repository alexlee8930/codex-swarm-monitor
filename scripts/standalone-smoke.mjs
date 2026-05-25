#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(execFileSync(process.execPath, ["scripts/build-standalone.mjs"], { cwd: root, encoding: "utf8" }));
const bundleRoot = join(root, "dist", manifest.bundle);
const launcher = join(bundleRoot, manifest.entrypoint);
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-standalone-"));

try {
  assert.equal(existsSync(launcher), true);
  const help = runLauncherSync(launcher, ["--help"]);
  assert.match(help, /--doctor/);
  assert.match(help, /--support/);
  assert.equal(existsSync(join(bundleRoot, "app/build-info.json")), true);
  assert.match(readFileSync(join(bundleRoot, "README-STANDALONE.md"), "utf8"), /--support > codex-swarm-support\.json/);
  const buildInfo = JSON.parse(readFileSync(join(bundleRoot, "app/build-info.json"), "utf8"));
  assert.equal(buildInfo.version, manifest.version);
  assert.equal(buildInfo.target, manifest.target);
  assert.match(runLauncherSync(launcher, ["--version"]), /codex-swarm-monitor 0\.1\.0 \(standalone/);
  const versionJson = JSON.parse(runLauncherSync(launcher, ["--version", "--json"]));
  assert.equal(versionJson.distribution, "standalone");
  assert.equal(versionJson.build.target, manifest.target);
  smokeInstaller(bundleRoot, manifest.entrypoint, temp);

  const workspace = join(temp, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "AGENTS.md"), "# Agents\n");
  const support = JSON.parse(runLauncherSync(launcher, ["--workspace", workspace, "--support"]));
  assert.equal(support.version.distribution, "standalone");
  assert.equal(support.privacy.syntheticEvents, false);
  assert.equal(support.workspace.root, workspace);
  assert.ok(support.release.plan.some((item) => item.id === "verify-source"));

  const boot = await startStandalone(launcher, workspace);
  const base = boot.url;
  try {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
    const version = await (await fetch(`${base}/version`)).json();
    assert.equal(version.distribution, "standalone");
    assert.equal(version.build.bundle, manifest.bundle);
    const connected = await (
      await fetch(`${base}/workspace/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: workspace, eventBusUrl: base })
      })
    ).json();
    assert.equal(connected.install.configured, true);
    assert.equal(existsSync(join(workspace, ".codex/codex-swarm-monitor/hook.mjs")), true);
    assert.doesNotMatch(readFileSync(join(workspace, ".codex/codex-swarm-monitor/hook.mjs"), "utf8"), new RegExp(escapeRegex(root)));
  } finally {
    boot.child.kill("SIGTERM");
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function startStandalone(launcher, workspace) {
  return new Promise((resolveStart, rejectStart) => {
    const child = spawn(launcher, ["--workspace", workspace, "--port", "0"], {
      cwd: workspace,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectStart(new Error(`Timed out waiting for standalone URL: ${stdout}${stderr}`));
    }, 5000);

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
        rejectStart(new Error(`Standalone exited ${code}: ${stderr}`));
      }
    });
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runLauncherSync(launcher, args) {
  return execFileSync(launcher, args, { encoding: "utf8", shell: process.platform === "win32" });
}

function smokeInstaller(bundleRoot, entrypoint, temp) {
  if (process.platform === "win32") {
    const installer = join(bundleRoot, "install.ps1");
    assert.equal(existsSync(installer), true);
    assert.equal(entrypoint, "bin/codex-swarm-monitor.cmd");
    return;
  }

  const installer = join(bundleRoot, "install.sh");
  const prefix = join(temp, "prefix");
  assert.equal(existsSync(installer), true);
  execFileSync(installer, { env: { ...process.env, PREFIX: prefix }, stdio: "pipe" });
  const installed = join(prefix, "bin/codex-swarm-monitor");
  const installedApp = join(prefix, "lib/codex-swarm-monitor/app/apps/backend/src/index.mjs");
  const installedRuntime = join(prefix, "lib/codex-swarm-monitor/runtime/node");
  assert.equal(existsSync(installed), true);
  assert.equal(existsSync(installedApp), true);
  assert.equal(existsSync(installedRuntime), true);
  assert.doesNotMatch(readFileSync(installed, "utf8"), new RegExp(escapeRegex(bundleRoot)));
  const help = execFileSync(installed, ["--help"], { encoding: "utf8", env: { ...process.env, PATH: "/usr/bin:/bin" } });
  assert.match(help, /--workspace <path>/);
  assert.match(help, /--support/);
}
