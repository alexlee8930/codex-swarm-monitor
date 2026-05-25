#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-marketplace-submission-"));

try {
  const output = execFileSync(process.execPath, ["scripts/build-marketplace-submission.mjs"], { cwd: root, encoding: "utf8" });
  const manifest = JSON.parse(output);
  const archive = join(root, manifest.archive);
  const checksumFile = join(root, manifest.checksumFile);
  assert.equal(existsSync(archive), true);
  assert.equal(existsSync(checksumFile), true);
  assert.equal(readFileSync(checksumFile, "utf8").trim(), `${sha256(archive)}  ${basename(archive)}`);

  execFileSync("tar", ["-xzf", archive, "-C", temp], { stdio: "pipe" });
  const extractedRoot = join(temp, `${manifest.name}-marketplace-submission-${manifest.version}`);
  const submission = JSON.parse(readFileSync(join(extractedRoot, "submission.json"), "utf8"));
  const releaseAssets = JSON.parse(readFileSync(join(extractedRoot, "release-assets.json"), "utf8"));
  const submissionMarkdown = readFileSync(join(extractedRoot, "SUBMISSION.md"), "utf8");

  assert.equal(submission.name, "codex-swarm-monitor");
  assert.equal(submission.dataBoundary.mockData, false);
  assert.equal(submission.dataBoundary.remoteAvatarProvider, false);
  assert.match(submission.userPromise, /Codex only/);
  assert.match(submission.userPromise, /do not install Node, npm, Bun, OMX/);
  assert.match(submission.installCommand, /codex plugin add codex-swarm-monitor@codex-swarm-monitor/);
  assert.equal(releaseAssets.length, 10);
  assert.ok(releaseAssets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)));
  assert.equal(existsSync(join(extractedRoot, submission.artifacts.pluginArchive)), true);
  assert.equal(existsSync(join(extractedRoot, submission.artifacts.pluginChecksum)), true);
  assert.equal(readFileSync(join(extractedRoot, "assets/dashboard-desktop.png")).readUInt32BE(0), 0x89504e47);
  assert.ok(statSync(join(extractedRoot, "assets/dashboard-desktop.png")).size > 100_000);
  assert.match(submissionMarkdown, /No demo or seed events/);
  assert.match(submissionMarkdown, /Last-Event-ID replay/);
  assert.doesNotMatch(submissionMarkdown, /DiceBear|api\.dicebear|mockAgents|seedEvents/i);
  assert.equal(existsSync(join(extractedRoot, "apps")), false, "submission bundle must not contain development app source");
  assert.equal(existsSync(join(extractedRoot, "package.json")), false, "submission bundle must not require npm project metadata");
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
