#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { request } from "node:https";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const tag = process.env.CODEX_SWARM_RELEASE_VERSION || `v${version}`;
const target = normalizeTarget(process.env.CODEX_SWARM_DESKTOP_APP_TARGET || `${process.platform}-${process.arch}`);
const repo = githubRepo(packageJson.repository?.url || packageJson.homepage || "");
const releaseBase =
  process.env.CODEX_SWARM_RELEASE_BASE ||
  `https://github.com/${process.env.CODEX_SWARM_RELEASE_REPO || repo}/releases/download/${tag}`;

assert.ok(repo || process.env.CODEX_SWARM_RELEASE_REPO, "package repository or CODEX_SWARM_RELEASE_REPO is required");

if (!target.startsWith("darwin-")) {
  console.log(`remote desktop app smoke skipped: ${target} is not a macOS .app target`);
} else {
  const temp = mkdtempSync(join(tmpdir(), "codex-swarm-remote-desktop-"));

  try {
    const archiveName = `codex-swarm-monitor-${target}.app.tar.gz`;
    const archive = join(temp, archiveName);
    const checksum = join(temp, `${archiveName}.sha256`);

    await download(`${releaseBase}/${archiveName}`, archive);
    await download(`${releaseBase}/${archiveName}.sha256`, checksum);
    verifyChecksum(archive, checksum);
    assert.ok(statSync(archive).size > 1_000_000, `${archiveName} should include a bundled runtime`);

    execFileSync("tar", ["-xzf", archive, "-C", temp], { stdio: "pipe" });
    const appBundle = join(temp, "Codex Swarm Monitor.app");
    const executable = join(appBundle, "Contents/MacOS/Codex Swarm Monitor");
    const resources = join(appBundle, "Contents/Resources");
    const desktopManifest = JSON.parse(readFileSync(join(resources, "desktop-manifest.json"), "utf8"));
    const embeddedStandalone = join(resources, desktopManifest.embeddedStandalone);

    assert.equal(existsSync(join(appBundle, "Contents/Info.plist")), true);
    assert.equal(existsSync(join(appBundle, "Contents/PkgInfo")), true);
    assert.equal(existsSync(executable), true);
    assert.ok((statSync(executable).mode & 0o111) !== 0, "downloaded app launcher should be executable");
    assert.equal(desktopManifest.target, target);
    assert.equal(desktopManifest.version, version);
    assert.equal(existsSync(join(embeddedStandalone, "manifest.json")), true);
    assert.equal(existsSync(join(embeddedStandalone, "bin/codex-swarm-monitor")), true);

    const plist = readFileSync(join(appBundle, "Contents/Info.plist"), "utf8");
    assert.match(plist, /<key>CFBundleName<\/key>\s*<string>Codex Swarm Monitor<\/string>/);
    assert.match(plist, /<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/);

    if (target === `${process.platform}-${process.arch}`) {
      const versionJson = JSON.parse(execFileSync(executable, ["--version", "--json"], { encoding: "utf8" }));
      assert.equal(versionJson.distribution, "standalone");
      assert.equal(versionJson.version, version);
      assert.equal(versionJson.build.target, target);
    }

    console.log(`remote desktop app smoke ok: ${releaseBase}/${archiveName}`);
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function normalizeTarget(value) {
  const targetValue = String(value || "").replace(/^codex-swarm-monitor-/, "").replace(/\.app\.tar\.gz$/, "");
  if (!/^(darwin|linux|win32)-(arm64|x64)$/.test(targetValue)) {
    throw new Error(`Invalid desktop app target: ${value}`);
  }
  return targetValue;
}

function verifyChecksum(file, checksumFile) {
  const expected = readFileSync(checksumFile, "utf8").trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  assert.equal(actual, expected, `checksum mismatch for ${basename(file)}`);
}

function download(url, destination) {
  return new Promise((resolveDownload, rejectDownload) => {
    const attempt = (targetUrl, redirects = 0) => {
      const req = request(targetUrl, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirects >= 5) {
            rejectDownload(new Error(`too many redirects for ${url}`));
            return;
          }
          attempt(new URL(res.headers.location, targetUrl).toString(), redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          rejectDownload(new Error(`download failed ${res.statusCode}: ${targetUrl}`));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          writeFileSync(destination, Buffer.concat(chunks));
          resolveDownload();
        });
      });
      req.on("error", rejectDownload);
      req.setTimeout(30000, () => {
        req.destroy(new Error(`download timed out: ${targetUrl}`));
      });
      req.end();
    };
    attempt(url);
  });
}

function githubRepo(value) {
  return String(value || "")
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "")
    .replace(/^ssh:\/\/git@github\.com\//, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^http:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
}
