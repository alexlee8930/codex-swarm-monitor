#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-plugin-package-"));

try {
  const output = execFileSync(process.execPath, ["scripts/build-plugin-package.mjs"], { cwd: root, encoding: "utf8" });
  const manifest = JSON.parse(output);
  const archive = join(root, manifest.archive);
  const checksumFile = join(root, manifest.checksumFile);
  assert.equal(existsSync(archive), true);
  assert.equal(existsSync(checksumFile), true);
  assert.equal(readFileSync(checksumFile, "utf8").trim(), `${sha256(archive)}  ${basename(archive)}`);

  execFileSync("tar", ["-xzf", archive, "-C", temp], { stdio: "pipe" });
  const extractedRoot = join(temp, `${manifest.name}-plugin-${manifest.version}`);
  const pluginRoot = join(extractedRoot, "codex-swarm-monitor");
  const pluginJson = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));
  const marketplace = JSON.parse(readFileSync(join(extractedRoot, "marketplace.json"), "utf8"));
  const screenshot = join(pluginRoot, "assets/screenshots/dashboard-desktop.png");

  assert.equal(pluginJson.name, "codex-swarm-monitor");
  assert.equal(pluginJson.version, manifest.version);
  assert.equal(pluginJson.interface.screenshots[0].path, "./assets/screenshots/dashboard-desktop.png");
  assert.equal(marketplace.plugins[0].name, pluginJson.name);
  assert.equal(marketplace.plugins[0].source.path, "./codex-swarm-monitor");
  assert.equal(existsSync(join(extractedRoot, marketplace.plugins[0].source.path)), true);
  assert.equal(existsSync(join(pluginRoot, "skills/codex-swarm-monitor/SKILL.md")), true);
  assert.equal(existsSync(join(pluginRoot, "scripts/install-standalone.sh")), true);
  assert.equal(existsSync(join(pluginRoot, "scripts/install-standalone.ps1")), true);
  assert.equal(existsSync(join(pluginRoot, "MARKETPLACE.md")), true);
  assert.match(readFileSync(join(pluginRoot, "MARKETPLACE.md"), "utf8"), /Codex only|No hosted service|Last-Event-ID|No Node\/npm\/source checkout/);
  assert.ok(statSync(screenshot).size > 100_000);
  assert.equal(readFileSync(screenshot).readUInt32BE(0), 0x89504e47);
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
