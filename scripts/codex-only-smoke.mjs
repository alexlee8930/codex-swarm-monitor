#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-codex-only-"));

try {
  const standalone = JSON.parse(execFileSync(process.execPath, ["scripts/build-standalone.mjs"], { cwd: root, encoding: "utf8" }));
  const packaged = JSON.parse(execFileSync(process.execPath, ["scripts/build-plugin-package.mjs"], { cwd: root, encoding: "utf8" }));
  const archive = join(root, packaged.archive);
  const checksum = join(root, packaged.checksumFile);
  assert.equal(existsSync(archive), true);
  assert.equal(existsSync(checksum), true);

  execFileSync("tar", ["-xzf", archive, "-C", temp], { stdio: "pipe" });
  const packageRoot = join(temp, `${packaged.name}-plugin-${packaged.version}`);
  const pluginRoot = join(packageRoot, "codex-swarm-monitor");
  const marketplace = JSON.parse(readFileSync(join(packageRoot, "marketplace.json"), "utf8"));
  const skill = readFileSync(join(pluginRoot, "skills/codex-swarm-monitor/SKILL.md"), "utf8");

  assert.equal(marketplace.plugins[0].source.path, "./codex-swarm-monitor");
  assert.equal(existsSync(join(pluginRoot, ".codex-plugin/plugin.json")), true);
  assert.equal(existsSync(join(pluginRoot, "scripts/start-monitor.sh")), true);
  assert.equal(existsSync(join(pluginRoot, "scripts/install-standalone.sh")), true);
  assert.equal(existsSync(join(pluginRoot, "apps/backend/src/index.mjs")), false);
  assert.equal(existsSync(join(pluginRoot, "package.json")), false);
  assert.match(skill, /Codex user start the monitor without OMX or manual Node project setup/);
  assert.match(skill, /Codex is the only prerequisite/);
  assert.match(skill, /publication problem, not a user setup problem/);
  assert.match(skill, /0` agents and `0` events/);
  assert.match(skill, /Do not present it as an end-user path/);
  assert.doesNotMatch(skill, /npm install/);

  if (process.platform === "win32") {
    const output = execFileSync(
      "powershell",
      ["-ExecutionPolicy", "Bypass", "-File", join(pluginRoot, "scripts/start-monitor.ps1"), "--help"],
      {
        cwd: temp,
        env: {
          ...process.env,
          CODEX_SWARM_RELEASE_DIR: join(root, "dist"),
          CODEX_SWARM_TARGET: standalone.target,
          PREFIX: join(temp, "prefix"),
          PATH: "C:\\Windows\\System32;C:\\Windows"
        },
        encoding: "utf8"
      }
    );
    assert.match(output, /--workspace <path>/);
  } else {
    const output = execFileSync("sh", [join(pluginRoot, "scripts/start-monitor.sh"), "--help"], {
      cwd: temp,
      env: {
        ...process.env,
        CODEX_SWARM_RELEASE_DIR: join(root, "dist"),
        CODEX_SWARM_TARGET: standalone.target,
        PREFIX: join(temp, "prefix"),
        PATH: "/usr/bin:/bin"
      },
      encoding: "utf8"
    });
    assert.match(output, /--workspace <path>/);
    assert.equal(existsSync(join(temp, "prefix/bin/codex-swarm-monitor")), true);
  }

  assert.match(readFileSync(checksum, "utf8"), new RegExp(`  ${escapeRegex(basename(archive))}\\n?$`));
  console.log("codex-only packaged plugin smoke ok");
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
