#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const codex = process.env.CODEX_BIN || findCodex();
const requireCodex = process.env.CODEX_SWARM_REQUIRE_CODEX_PLUGIN_SMOKE === "1";

if (!codex) {
  if (requireCodex) throw new Error("codex CLI is required for codex plugin install smoke");
  console.log("codex plugin install smoke skipped: codex CLI not found");
  process.exit(0);
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-plugin-install-"));

try {
  const codexHome = join(temp, "codex-home");
  mkdirSync(codexHome, { recursive: true });
  const source = process.env.CODEX_SWARM_MARKETPLACE_SOURCE || root;
  const selector = process.env.CODEX_SWARM_MARKETPLACE_SELECTOR || "codex-swarm-monitor@codex-swarm-monitor";
  const env = { ...process.env, CODEX_HOME: codexHome };

  execFileSync(codex, ["plugin", "marketplace", "add", source], { env, stdio: "pipe" });
  const available = execFileSync(codex, ["plugin", "list"], { env, encoding: "utf8" });
  assert.match(available, new RegExp(escapeRegex(selector)), "plugin must be listed from the configured marketplace");

  execFileSync(codex, ["plugin", "add", selector], { env, stdio: "pipe" });
  const installed = execFileSync(codex, ["plugin", "list"], { env, encoding: "utf8" });
  assert.match(installed, new RegExp(`${escapeRegex(selector)}\\s+installed`), "plugin must be marked installed");

  const installedRoot = findInstalledPlugin(codexHome, packageJson.version);
  assert.ok(installedRoot, "installed plugin cache root must exist");
  assert.equal(existsSync(join(installedRoot, ".codex-plugin/plugin.json")), true);
  assert.equal(existsSync(join(installedRoot, "skills/codex-swarm-monitor/SKILL.md")), true);
  assert.equal(existsSync(join(installedRoot, "scripts/start-monitor.sh")), true);
  assert.equal(existsSync(join(installedRoot, "assets/screenshots/dashboard-desktop.png")), true);

  const plugin = JSON.parse(readFileSync(join(installedRoot, ".codex-plugin/plugin.json"), "utf8"));
  assert.equal(plugin.name, "codex-swarm-monitor");
  assert.equal(plugin.version, packageJson.version);
  assert.deepEqual(plugin.interface.screenshots, ["./assets/screenshots/dashboard-desktop.png"]);

  console.log(`codex plugin install smoke ok: ${selector}`);
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function findCodex() {
  try {
    return execFileSync("sh", ["-c", "command -v codex"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function findInstalledPlugin(codexHome, version) {
  const cache = join(codexHome, "plugins/cache");
  for (const path of listDirs(cache)) {
    if (path.endsWith(`codex-swarm-monitor/${version}`)) return path;
  }
  return "";
}

function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? [path, ...listDirs(path)] : [];
  });
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
