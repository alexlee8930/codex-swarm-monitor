#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const distRoot = join(root, "dist");
const pluginRoot = join(root, "plugins/codex-swarm-monitor");
const manifest = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));
const packageName = `${manifest.name}-plugin-${manifest.version}`;
const packageRoot = join(distRoot, packageName);
const archive = join(distRoot, `${packageName}.tar.gz`);
const checksumFile = `${archive}.sha256`;

rmSync(packageRoot, { recursive: true, force: true });
rmSync(archive, { force: true });
rmSync(checksumFile, { force: true });
mkdirSync(packageRoot, { recursive: true });

cpSync(pluginRoot, join(packageRoot, "codex-swarm-monitor"), { recursive: true, dereference: true });
writeFileSync(
  join(packageRoot, "marketplace.json"),
  `${JSON.stringify(packageMarketplace(readJson(join(root, "marketplace.json"))), null, 2)}\n`
);
execFileSync("tar", ["-czf", archive, "-C", distRoot, packageName], { stdio: "pipe" });

const checksum = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(checksumFile, `${checksum}  ${basename(archive)}\n`);

assert.ok(statSync(archive).size > 100_000, "plugin package should include manifest, skill, scripts, and screenshot asset");
assert.equal(existsSync(join(packageRoot, "codex-swarm-monitor/.codex-plugin/plugin.json")), true);
assert.equal(existsSync(join(packageRoot, "codex-swarm-monitor/assets/screenshots/dashboard-desktop.png")), true);
assert.equal(existsSync(join(packageRoot, "marketplace.json")), true);

console.log(JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  archive: `dist/${basename(archive)}`,
  checksumFile: `dist/${basename(checksumFile)}`,
  checksum
}, null, 2));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function packageMarketplace(marketplace) {
  return {
    ...marketplace,
    plugins: (marketplace.plugins || []).map((plugin) =>
      plugin.name === manifest.name
        ? {
            ...plugin,
            source: {
              source: "local",
              path: "./codex-swarm-monitor"
            }
          }
        : plugin
    )
  };
}
