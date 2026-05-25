#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-package-"));

try {
  const packOutput = npmPackJson(root);
  const [{ filename }] = JSON.parse(packOutput);
  const tarball = join(root, filename);
  execFileSync("tar", ["-xzf", tarball, "-C", temp], { stdio: "pipe" });
  rmSync(tarball, { force: true });

  const packedRoot = join(temp, "package");
  const packageJson = JSON.parse(readFileSync(join(packedRoot, "package.json"), "utf8"));
  assert.equal(packageJson.bin["codex-swarm-monitor"], "apps/backend/src/index.mjs");
  assert.equal(packageJson.license, "MIT");
  assert.equal(existsSync(join(packedRoot, "apps/ui/index.html")), true);
  assert.equal(existsSync(join(packedRoot, "LICENSE")), true);
  assert.equal(existsSync(join(packedRoot, "marketplace.json")), true);
  assert.equal(existsSync(join(packedRoot, ".agents/plugins/marketplace.json")), true);
  assert.equal(existsSync(join(packedRoot, "plugins/codex-swarm-monitor/.codex-plugin/plugin.json")), true);
  assert.equal(existsSync(join(packedRoot, "plugins/codex-swarm-monitor/skills/codex-swarm-monitor/SKILL.md")), true);
  assert.equal(existsSync(join(packedRoot, "plugins/codex-swarm-monitor/scripts/start-monitor.mjs")), true);
  assert.equal(existsSync(join(packedRoot, "plugins/codex-swarm-monitor/scripts/start-monitor.sh")), true);
  assert.equal(existsSync(join(packedRoot, "plugins/codex-swarm-monitor/scripts/start-monitor.ps1")), true);
  assert.equal(existsSync(join(packedRoot, "plugins/codex-swarm-monitor/scripts/install-standalone.sh")), true);
  assert.equal(existsSync(join(packedRoot, "plugins/codex-swarm-monitor/scripts/install-standalone.ps1")), true);
  const help = execFileSync(process.execPath, [join(packedRoot, "apps/backend/src/index.mjs"), "--help"], { encoding: "utf8" });
  assert.match(help, /--workspace <path>/);
  assert.match(help, /--connect/);
  assert.match(help, /--support/);
  assert.match(execFileSync(process.execPath, [join(packedRoot, "apps/backend/src/index.mjs"), "--version"], { encoding: "utf8" }), /codex-swarm-monitor 0\.1\.0/);
  const versionJson = JSON.parse(execFileSync(process.execPath, [join(packedRoot, "apps/backend/src/index.mjs"), "--version", "--json"], { encoding: "utf8" }));
  assert.equal(versionJson.distribution, "source");
  assert.equal(versionJson.version, packageJson.version);
  const supportJson = JSON.parse(execFileSync(process.execPath, [join(packedRoot, "apps/backend/src/index.mjs"), "--workspace", packedRoot, "--support"], { encoding: "utf8" }));
  assert.equal(supportJson.service, "codex-swarm-monitor");
  assert.equal(supportJson.workspace.root, packedRoot);
  assert.equal(supportJson.privacy.syntheticEvents, false);
  assert.ok(supportJson.release.plan.some((item) => item.id === "verify-source"));
  assert.match(execFileSync(process.execPath, [join(packedRoot, "plugins/codex-swarm-monitor/scripts/start-monitor.mjs"), "--help"], { encoding: "utf8" }), /--workspace <path>/);

  const { createSwarmServer } = await import(pathToFileURL(join(packedRoot, "apps/backend/src/server.mjs")).href);
  const server = createSwarmServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const workspace = join(temp, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "AGENTS.md"), "# Agents\n");

  try {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
    const version = await (await fetch(`${base}/version`)).json();
    assert.equal(version.version, packageJson.version);
    assert.equal(version.distribution, "source");
    const doctorBeforeInstall = await (await fetch(`${base}/doctor?path=${encodeURIComponent(workspace)}`)).json();
    assert.ok(doctorBeforeInstall.checks.some((item) => item.id === "workspace-writable" && item.ok));

    const connected = await (
      await fetch(`${base}/workspace/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: workspace, eventBusUrl: base })
      })
    ).json();

    assert.equal(connected.install.configured, true);
    const doctorAfterInstall = await (await fetch(`${base}/doctor?path=${encodeURIComponent(workspace)}`)).json();
    assert.equal(doctorAfterInstall.checks.find((item) => item.id === "hook-installed").ok, true);
    const embeddedHook = join(workspace, ".codex/codex-swarm-monitor/hook.mjs");
    assert.equal(existsSync(embeddedHook), true);
    assert.doesNotMatch(readFileSync(embeddedHook, "utf8"), new RegExp(escapeRegex(root)));
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  const cliWorkspace = join(temp, "cli-workspace");
  await mkdir(cliWorkspace, { recursive: true });
  await writeFile(join(cliWorkspace, "AGENTS.md"), "# CLI Workspace\n");
  const cliOutput = await runPackedCli(packedRoot, cliWorkspace);
  assert.match(cliOutput, /Codex Swarm Monitor running at http:\/\/127\.0\.0\.1:\d+/);
  assert.match(cliOutput, new RegExp(escapeRegex(`Workspace: ${cliWorkspace}`)));
  assert.match(cliOutput, /Hooks installed: 7\/7 lifecycle events/);
  assert.equal(existsSync(join(cliWorkspace, ".codex/codex-swarm-monitor/hook.mjs")), true);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function npmPackJson(cwd) {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, "pack", "--json"], { cwd, encoding: "utf8" });
  }
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return execFileSync(command, ["pack", "--json"], { cwd, encoding: "utf8", shell: process.platform === "win32" });
}

function runPackedCli(packedRoot, workspace) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [join(packedRoot, "apps/backend/src/index.mjs"), "--workspace", workspace, "--port", "0", "--connect"], {
      cwd: packedRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectRun(new Error(`Timed out waiting for CLI output: ${output}${stderr}`));
    }, 4000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("Open the URL")) {
        clearTimeout(timer);
        child.kill("SIGTERM");
        resolveRun(output);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (output.includes("Open the URL")) resolveRun(output);
      else if (code !== 0 && code !== null) rejectRun(new Error(`CLI exited ${code}: ${stderr}`));
    });
  });
}
