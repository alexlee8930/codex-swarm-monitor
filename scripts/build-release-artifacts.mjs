#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const root = resolve(import.meta.dirname, "..");
const cacheRoot = join(root, ".cache", "node-runtimes");
const nodeVersion = process.version;
const targets = [
  "linux-x64",
  "darwin-arm64",
  "darwin-x64",
  "win32-x64"
];

const shasums = await fetchText(nodeUrl("SHASUMS256.txt"));

for (const target of targets) {
  const runtime = await ensureRuntime(target);
  const manifest = JSON.parse(
    execFileSync(process.execPath, ["scripts/build-standalone.mjs", "--target", target, "--node-runtime", runtime], {
      cwd: root,
      encoding: "utf8"
    })
  );
  assert.equal(manifest.target, target);
  assert.ok(manifest.checksum, `${target} checksum should be present`);
  console.log(`built ${manifest.archive}`);
  if (target.startsWith("darwin-")) {
    const desktopManifest = JSON.parse(
      execFileSync(process.execPath, ["scripts/build-desktop-app.mjs", "--target", target, "--no-build-standalone"], {
        cwd: root,
        encoding: "utf8"
      })
    );
    assert.equal(desktopManifest.target, target);
    assert.ok(desktopManifest.checksum, `${target} desktop app checksum should be present`);
    console.log(`built ${desktopManifest.archive}`);
  }
}

execFileSync(process.execPath, ["scripts/verify-release-artifacts.mjs", "--standalone-only", "dist"], {
  cwd: root,
  stdio: "inherit"
});

async function ensureRuntime(target) {
  const info = runtimeInfo(target);
  const archivePath = join(cacheRoot, info.archiveName);
  mkdirSync(cacheRoot, { recursive: true });

  if (!existsSync(archivePath)) {
    await download(nodeUrl(info.archiveName), archivePath);
  }
  verifyChecksum(archivePath, info.archiveName);

  const extractRoot = join(cacheRoot, `${nodeVersion}-${target}`);
  const runtimePath = join(extractRoot, info.runtimeRelativePath);
  if (!existsSync(runtimePath)) {
    rmSync(extractRoot, { recursive: true, force: true });
    mkdirSync(extractRoot, { recursive: true });
    extractArchive(archivePath, extractRoot);
  }
  assert.equal(existsSync(runtimePath), true, `Node runtime missing after extraction: ${runtimePath}`);
  return runtimePath;
}

function runtimeInfo(target) {
  const [platform, arch] = target.split("-");
  const nodePlatform = platform === "win32" ? "win" : platform;
  const extension = platform === "win32" ? "zip" : "tar.xz";
  const folder = `node-${nodeVersion}-${nodePlatform}-${arch}`;
  return {
    archiveName: `${folder}.${extension}`,
    runtimeRelativePath: platform === "win32" ? join(folder, "node.exe") : join(folder, "bin", "node")
  };
}

function nodeUrl(file) {
  return `https://nodejs.org/dist/${nodeVersion}/${file}`;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

async function download(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Failed to download ${url}: ${response.status}`);
  mkdirSync(dirname(outputPath), { recursive: true });
  await pipeline(response.body, createWriteStream(outputPath));
}

function verifyChecksum(path, name) {
  const expected = shasums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === name)?.[0];
  assert.match(expected || "", /^[a-f0-9]{64}$/, `${name} should be listed in official Node checksums`);
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.equal(actual, expected, `${name} checksum should match official Node SHASUMS256.txt`);
}

function extractArchive(archivePath, extractRoot) {
  if (archivePath.endsWith(".zip")) {
    execFileSync("unzip", ["-q", archivePath, "-d", extractRoot], { stdio: "pipe" });
    return;
  }
  execFileSync("tar", ["-xJf", archivePath, "-C", extractRoot], { stdio: "pipe" });
}
