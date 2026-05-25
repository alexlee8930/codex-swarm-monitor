#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-artifact-"));

try {
  const manifest = JSON.parse(execFileSync(process.execPath, ["scripts/build-standalone.mjs"], { cwd: root, encoding: "utf8" }));
  const archive = join(root, manifest.archive || "");
  const checksumFile = `${archive}.sha256`;

  assert.equal(manifest.name, "codex-swarm-monitor");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.target, /^(darwin|linux|win32)-/);
  assert.equal(manifest.bundle, `codex-swarm-monitor-${manifest.target}`);
  assert.equal(Object.hasOwn(manifest, "bundleRoot"), false, "release manifest must not contain build-machine absolute paths");
  assert.equal(manifest.checksumFile, `${manifest.archive}.sha256`);
  assert.equal(existsSync(archive), true, "standalone archive must exist");
  assert.equal(existsSync(checksumFile), true, "standalone checksum must exist");
  assert.ok(statSync(archive).size > 1_000_000, "standalone archive should include a Node runtime");

  const actualChecksum = sha256(archive);
  const checksumLine = readFileSync(checksumFile, "utf8").trim();
  assert.equal(checksumLine, `${actualChecksum}  ${basename(archive)}`);
  assert.equal(manifest.checksum, actualChecksum);

  execFileSync("tar", ["-xzf", archive, "-C", temp], { stdio: "pipe" });
  const extractedRoot = join(temp, manifest.bundle);
  const extractedManifest = JSON.parse(readFileSync(join(extractedRoot, "manifest.json"), "utf8"));
  assert.deepEqual(extractedManifest, withoutComputedChecksum(manifest));
  assert.equal(existsSync(join(extractedRoot, manifest.entrypoint)), true);
  assert.equal(existsSync(join(extractedRoot, "app/apps/ui/index.html")), true);
  assert.equal(existsSync(join(extractedRoot, "app/apps/backend/src/index.mjs")), true);
  assert.equal(existsSync(join(extractedRoot, "app/plugins/codex-swarm-monitor/assets/screenshots/dashboard-desktop.png")), true);
  assert.equal(existsSync(join(extractedRoot, "README-STANDALONE.md")), true);
  assert.match(readFileSync(join(extractedRoot, "README-STANDALONE.md"), "utf8"), /--support > codex-swarm-support\.json/);

  const launcher = join(extractedRoot, manifest.entrypoint);
  const help = execFileSync(launcher, ["--help"], { encoding: "utf8", shell: process.platform === "win32" });
  assert.match(help, /--workspace <path>/);
  assert.match(help, /--support/);

  const serialized = JSON.stringify(extractedManifest);
  assert.doesNotMatch(serialized, new RegExp(escapeRegex(root)), "manifest must not leak source checkout paths");
  console.log(`artifact audit ok: ${manifest.archive}`);
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function withoutComputedChecksum(manifest) {
  const copy = { ...manifest };
  delete copy.checksum;
  return copy;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
