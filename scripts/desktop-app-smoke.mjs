#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));

if (!args.target.startsWith("darwin-")) {
  if (args.require) {
    throw new Error(`Desktop app smoke only supports darwin targets, received ${args.target}`);
  }
  console.log(`desktop app smoke skipped: ${args.target} is not a macOS .app target`);
  process.exit(0);
}

const manifest = JSON.parse(
  execFileSync(process.execPath, ["scripts/build-desktop-app.mjs", "--target", args.target, args.buildStandalone ? "--build-standalone" : "--no-build-standalone"], {
    cwd: root,
    encoding: "utf8"
  })
);
const appBundle = join(root, manifest.stage);
const executable = join(appBundle, manifest.executable);
const resources = join(appBundle, "Contents/Resources");
const embeddedStandalone = join(resources, manifest.embeddedStandalone);
const archive = join(root, manifest.archive);
const checksumFile = join(root, manifest.checksumFile);

assert.equal(manifest.name, "codex-swarm-monitor-desktop-app");
assert.equal(manifest.bundle, "Codex Swarm Monitor.app");
assert.match(manifest.target, /^darwin-(arm64|x64)$/);
assert.equal(existsSync(appBundle), true);
assert.equal(existsSync(executable), true);
assert.ok((statSync(executable).mode & 0o111) !== 0, "app launcher should be executable");
assert.equal(existsSync(join(appBundle, "Contents/Info.plist")), true);
assert.equal(existsSync(join(appBundle, "Contents/PkgInfo")), true);
assert.equal(existsSync(join(resources, "README-DESKTOP-APP.md")), true);
assert.equal(existsSync(join(resources, "desktop-manifest.json")), true);
assert.equal(existsSync(join(embeddedStandalone, "manifest.json")), true);
assert.equal(existsSync(join(embeddedStandalone, "bin/codex-swarm-monitor")), true);
assert.equal(existsSync(archive), true);
assert.equal(existsSync(checksumFile), true);
assert.ok(statSync(archive).size > 1_000_000, "desktop app archive should include a bundled runtime");

const checksumLine = readFileSync(checksumFile, "utf8").trim();
assert.equal(checksumLine, `${sha256(archive)}  ${basename(archive)}`);

const plist = readFileSync(join(appBundle, "Contents/Info.plist"), "utf8");
assert.match(plist, /<key>CFBundleName<\/key>\s*<string>Codex Swarm Monitor<\/string>/);
assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>Codex Swarm Monitor<\/string>/);
assert.match(plist, /<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/);
assert.match(plist, new RegExp(`<key>CFBundleShortVersionString<\\/key>\\s*<string>${escapeRegex(manifest.version)}<\\/string>`));

const desktopManifest = JSON.parse(readFileSync(join(resources, "desktop-manifest.json"), "utf8"));
assert.equal(desktopManifest.target, manifest.target);
assert.equal(desktopManifest.embeddedStandalone, manifest.embeddedStandalone);
assert.equal(Object.hasOwn(desktopManifest, "checksum"), false);

if (manifest.target === `${process.platform}-${process.arch}`) {
  const version = JSON.parse(execFileSync(executable, ["--version", "--json"], { encoding: "utf8" }));
  assert.equal(version.distribution, "standalone");
  assert.equal(version.build.target, manifest.target);
  const help = execFileSync(executable, ["--help"], { encoding: "utf8" });
  assert.match(help, /--workspace <path>/);
  assert.match(help, /--connect/);
} else {
  console.log(`desktop app execution skipped: built ${manifest.target} on ${process.platform}-${process.arch}`);
}

console.log(`desktop app smoke ok: ${manifest.archive}`);

function parseArgs(argv) {
  const options = {
    target: `${process.platform}-${process.arch}`,
    require: process.env.CODEX_SWARM_REQUIRE_DESKTOP_APP_SMOKE === "1",
    buildStandalone: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      options.target = normalizeTarget(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--target=")) {
      options.target = normalizeTarget(arg.slice("--target=".length));
    } else if (arg === "--require") {
      options.require = true;
    } else if (arg === "--no-build-standalone") {
      options.buildStandalone = false;
    } else if (arg === "--build-standalone") {
      options.buildStandalone = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function normalizeTarget(value) {
  return String(value || "").replace(/^codex-swarm-monitor-/, "");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
