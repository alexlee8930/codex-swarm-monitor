#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { request } from "node:https";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const tag = process.env.CODEX_SWARM_RELEASE_VERSION || `v${version}`;
const repo = githubRepo(packageJson.repository?.url || packageJson.homepage || "");
const releaseBase =
  process.env.CODEX_SWARM_RELEASE_BASE ||
  `https://github.com/${process.env.CODEX_SWARM_RELEASE_REPO || repo}/releases/download/${tag}`;
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-remote-release-"));

try {
  assert.ok(repo || process.env.CODEX_SWARM_RELEASE_REPO, "package repository or CODEX_SWARM_RELEASE_REPO is required");
  const pluginArchiveName = `codex-swarm-monitor-plugin-${version}.tar.gz`;
  const pluginArchive = join(temp, pluginArchiveName);
  const pluginChecksum = join(temp, `${pluginArchiveName}.sha256`);

  await download(`${releaseBase}/${pluginArchiveName}`, pluginArchive);
  await download(`${releaseBase}/${pluginArchiveName}.sha256`, pluginChecksum);
  verifyChecksum(pluginArchive, pluginChecksum);

  execFileSync("tar", ["-xzf", pluginArchive, "-C", temp], { stdio: "pipe" });
  const pluginRoot = join(temp, `codex-swarm-monitor-plugin-${version}`, "codex-swarm-monitor");
  assert.equal(existsSync(join(pluginRoot, ".codex-plugin/plugin.json")), true);
  assert.equal(existsSync(join(pluginRoot, "scripts/start-monitor.sh")), true);
  assert.equal(existsSync(join(pluginRoot, "apps/backend/src/index.mjs")), false);
  assert.equal(existsSync(join(pluginRoot, "package.json")), false);

  const prefix = join(temp, "prefix");
  const env = remoteBootstrapEnv({ prefix });
  if (process.platform === "win32") {
    const output = execFileSync(
      "powershell",
      ["-ExecutionPolicy", "Bypass", "-File", join(pluginRoot, "scripts/start-monitor.ps1"), "--help"],
      { cwd: temp, env, encoding: "utf8" }
    );
    assert.match(output, /--workspace <path>/);
    const launcher = join(prefix, "bin/codex-swarm-monitor.cmd");
    assert.equal(existsSync(launcher), true);
    assert.match(execFileSync(launcher, ["--version"], { encoding: "utf8", shell: true }), new RegExp(`\\b${escapeRegex(version)}\\b`));
  } else {
    const output = execFileSync("sh", [join(pluginRoot, "scripts/start-monitor.sh"), "--help"], {
      cwd: temp,
      env,
      encoding: "utf8"
    });
    assert.match(output, /--workspace <path>/);
    const launcher = join(prefix, "bin/codex-swarm-monitor");
    assert.equal(existsSync(launcher), true);
    assert.match(execFileSync(launcher, ["--version"], { encoding: "utf8", env: minimalPathEnv() }), new RegExp(`\\b${escapeRegex(version)}\\b`));
  }

  console.log(`remote release bootstrap smoke ok: ${releaseBase}`);
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function remoteBootstrapEnv({ prefix }) {
  const env = {
    ...process.env,
    CODEX_SWARM_RELEASE_BASE: releaseBase,
    CODEX_SWARM_RELEASE_VERSION: tag,
    HOME: join(temp, "home"),
    PREFIX: prefix,
    PATH: minimalPath()
  };
  delete env.CODEX_SWARM_RELEASE_DIR;
  delete env.NODE_PATH;
  return env;
}

function minimalPathEnv() {
  const env = { ...process.env, PATH: minimalPath() };
  delete env.NODE_PATH;
  return env;
}

function minimalPath() {
  if (process.platform === "win32") {
    return [
      "C:\\Windows\\System32",
      "C:\\Windows",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0"
    ].join(";");
  }
  return "/usr/bin:/bin";
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
