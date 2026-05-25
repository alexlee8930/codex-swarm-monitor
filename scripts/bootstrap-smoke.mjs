#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-bootstrap-"));

try {
  const manifest = JSON.parse(execFileSync(process.execPath, ["scripts/build-standalone.mjs"], { cwd: root, encoding: "utf8" }));
  const installScript = join(root, "plugins/codex-swarm-monitor/scripts/install-standalone.sh");
  const windowsInstallScript = join(root, "plugins/codex-swarm-monitor/scripts/install-standalone.ps1");
  const startScript = join(root, "plugins/codex-swarm-monitor/scripts/start-monitor.sh");
  const windowsStartScript = join(root, "plugins/codex-swarm-monitor/scripts/start-monitor.ps1");
  const prefix = join(temp, "prefix");
  const wrapperPrefix = join(temp, "wrapper-prefix");

  assert.equal(existsSync(installScript), true);
  assert.equal(existsSync(windowsInstallScript), true);
  assert.equal(existsSync(startScript), true);
  assert.equal(existsSync(windowsStartScript), true);
  assertShellBootstrapShape(installScript);
  assertWindowsBootstrapShape(windowsInstallScript);
  assertShellStartShape(startScript);
  assertWindowsStartShape(windowsStartScript);

  if (process.platform === "win32") {
    execFileSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", windowsInstallScript], {
      cwd: root,
      env: {
        ...process.env,
        CODEX_SWARM_RELEASE_DIR: join(root, "dist"),
        CODEX_SWARM_TARGET: manifest.target,
        PREFIX: prefix
      },
      stdio: "pipe"
    });
    const installed = join(prefix, "bin/codex-swarm-monitor.cmd");
    assert.equal(existsSync(installed), true);
    assert.equal(existsSync(join(prefix, "app/app/apps/backend/src/index.mjs")), true);
    assert.match(execFileSync(installed, ["--help"], { encoding: "utf8", shell: true }), /--workspace <path>/);
    assert.match(
      execFileSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", windowsStartScript, "--help"], {
        cwd: root,
        env: {
          ...process.env,
          CODEX_SWARM_RELEASE_DIR: join(root, "dist"),
          CODEX_SWARM_TARGET: manifest.target,
          PREFIX: wrapperPrefix,
          PATH: "C:\\Windows\\System32;C:\\Windows"
        },
        encoding: "utf8"
      }),
      /--workspace <path>/
    );
    process.exit(0);
  }

  execFileSync(installScript, {
    cwd: root,
    env: {
      ...process.env,
      CODEX_SWARM_RELEASE_DIR: join(root, "dist"),
      CODEX_SWARM_TARGET: manifest.target,
      PREFIX: prefix
    },
    stdio: "pipe"
  });

  const installed = join(prefix, "bin/codex-swarm-monitor");
  assert.equal(existsSync(installed), true);
  assert.equal(existsSync(join(prefix, "lib/codex-swarm-monitor/app/apps/backend/src/index.mjs")), true);
  assert.equal(existsSync(join(prefix, "lib/codex-swarm-monitor/runtime/node")), true);
  assert.match(execFileSync(installed, ["--help"], { encoding: "utf8", env: { ...process.env, PATH: "/usr/bin:/bin" } }), /--workspace <path>/);
  assert.match(
    execFileSync(startScript, ["--help"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_SWARM_RELEASE_DIR: join(root, "dist"),
        CODEX_SWARM_TARGET: manifest.target,
        PREFIX: wrapperPrefix,
        PATH: "/usr/bin:/bin"
      }
    }),
    /--workspace <path>/
  );
  assertShellInstallFailure(installScript, manifest.target, temp);
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function assertShellBootstrapShape(path) {
  const script = readFileSync(path, "utf8");
  assert.match(script, /CODEX_SWARM_RELEASE_VERSION/);
  assert.match(script, /CODEX_SWARM_RELEASE_DIR/);
  assert.match(script, /CODEX_SWARM_RELEASE_BASE/);
  assert.match(script, /releases\/download\/\$RELEASE_VERSION/);
  assert.match(script, /PLUGIN_REPOSITORY/);
  assert.match(script, /darwin:x86_64\|darwin:amd64/);
  assert.match(script, /require tar/);
  assert.match(script, /standalone install failed/);
  assert.match(script, /release archive not found/);
  assert.match(script, /publish the matching GitHub release assets/i);
}

function assertShellStartShape(path) {
  const script = readFileSync(path, "utf8");
  assert.match(script, /install-standalone\.sh/);
  assert.match(script, /DEFAULT_LAUNCHER/);
  assert.match(script, /HAS_EXIT_ONLY/);
  assert.match(script, /REQUIRED_VERSION/);
  assert.match(script, /launcher_version_matches/);
  assert.match(script, /--version/);
  assert.match(script, /bootstrap failed before a launcher was available/);
  assert.match(script, /checked PATH plus/);
  assert.doesNotMatch(script, /\bnpx\b|\bnode\b/);
}

function assertWindowsBootstrapShape(path) {
  const script = readFileSync(path, "utf8");
  assert.match(script, /CODEX_SWARM_RELEASE_VERSION/);
  assert.match(script, /CODEX_SWARM_RELEASE_DIR/);
  assert.match(script, /CODEX_SWARM_RELEASE_BASE/);
  assert.match(script, /releases\/download\/\$releaseVersion/);
  assert.match(script, /pluginRepository/);
  assert.match(script, /function Get-Sha256/);
  assert.match(script, /Get-Command Get-FileHash/);
  assert.match(script, /SHA256Managed/);
  assert.match(script, /tar -xzf/);
  assert.match(script, /install\.ps1/);
  assert.match(script, /standalone install failed/);
  assert.match(script, /release archive not found/);
}

function assertWindowsStartShape(path) {
  const script = readFileSync(path, "utf8");
  assert.match(script, /install-standalone\.ps1/);
  assert.match(script, /codex-swarm-monitor\.cmd/);
  assert.match(script, /hasExitOnly/);
  assert.match(script, /requiredVersion/);
  assert.match(script, /--version/);
  assert.match(script, /bootstrap failed before a launcher was available/);
  assert.match(script, /checked PATH plus/);
  assert.doesNotMatch(script, /\bnpx\b/);
}

function assertShellInstallFailure(installScript, target, temp) {
  try {
    execFileSync(installScript, {
      cwd: root,
      env: {
        ...process.env,
        CODEX_SWARM_RELEASE_DIR: join(temp, "missing-release"),
        CODEX_SWARM_TARGET: target,
        PREFIX: join(temp, "failed-prefix")
      },
      encoding: "utf8",
      stdio: "pipe"
    });
    assert.fail("install-standalone.sh should fail when the release archive is missing");
  } catch (error) {
    const stderr = String(error.stderr || "");
    assert.match(stderr, /standalone install failed/);
    assert.match(stderr, /release archive not found/);
    assert.match(stderr, /CODEX_SWARM_RELEASE_DIR/);
    assert.match(stderr, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}
