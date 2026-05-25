#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const standaloneOnly = args.includes("--standalone-only");
const includeOptionalPlugin = args.includes("--include-optional-plugin");
const inputArgs = args.filter((arg) => !arg.startsWith("--"));
const inputDirs = (inputArgs.length ? inputArgs : [join(root, "dist")]).map((arg) => resolve(arg));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const requiredArchives = [
  "codex-swarm-monitor-linux-x64.tar.gz",
  "codex-swarm-monitor-darwin-arm64.tar.gz",
  "codex-swarm-monitor-darwin-x64.tar.gz",
  "codex-swarm-monitor-win32-x64.tar.gz"
];
const requiredDesktopAppArchives = [
  "codex-swarm-monitor-darwin-arm64.app.tar.gz",
  "codex-swarm-monitor-darwin-x64.app.tar.gz"
];
const requiredPluginFiles = [
  `codex-swarm-monitor-plugin-${packageJson.version}.tar.gz`,
  `codex-swarm-monitor-plugin-${packageJson.version}.tar.gz.sha256`
];
const requiredMarketplaceSubmissionFiles = [
  `codex-swarm-monitor-marketplace-submission-${packageJson.version}.tar.gz`,
  `codex-swarm-monitor-marketplace-submission-${packageJson.version}.tar.gz.sha256`
];
const requiredFiles = [
  ...requiredArchives.flatMap((name) => [name, `${name}.sha256`]),
  ...requiredDesktopAppArchives.flatMap((name) => [name, `${name}.sha256`]),
  ...(!standaloneOnly && includeOptionalPlugin ? [...requiredPluginFiles, ...requiredMarketplaceSubmissionFiles] : [])
];
const available = new Set(inputDirs.flatMap((dir) => listFiles(dir)).map((path) => basename(path)));
const missing = requiredFiles.filter((name) => !available.has(name));

assert.deepEqual(missing, [], `release artifact set is incomplete: missing ${missing.join(", ")}`);

for (const archiveName of requiredArchives) {
  const archivePath = findFile(inputDirs, archiveName);
  const checksumPath = findFile(inputDirs, `${archiveName}.sha256`);
  assert.ok(statSync(archivePath).size > 1_000_000, `${archiveName} should include a bundled runtime`);
  assert.match(readFileSync(checksumPath, "utf8"), new RegExp(`^[a-f0-9]{64}  ${escapeRegex(archiveName)}\\r?\\n?$`));
}

for (const archiveName of requiredDesktopAppArchives) {
  const archivePath = findFile(inputDirs, archiveName);
  const checksumPath = findFile(inputDirs, `${archiveName}.sha256`);
  assert.ok(statSync(archivePath).size > 1_000_000, `${archiveName} should include a bundled runtime`);
  assert.match(readFileSync(checksumPath, "utf8"), new RegExp(`^[a-f0-9]{64}  ${escapeRegex(archiveName)}\\r?\\n?$`));
}

if (!standaloneOnly && includeOptionalPlugin) {
  for (const artifactName of [...requiredPluginFiles, ...requiredMarketplaceSubmissionFiles]) {
    const artifactPath = findFile(inputDirs, artifactName);
    assert.ok(statSync(artifactPath).size > 64, `${artifactName} should not be empty`);
  }
  const pluginArchive = requiredPluginFiles[0];
  const pluginChecksum = readFileSync(findFile(inputDirs, requiredPluginFiles[1]), "utf8");
  assert.match(pluginChecksum, new RegExp(`^[a-f0-9]{64}  ${escapeRegex(pluginArchive)}\\r?\\n?$`));
  const submissionArchive = requiredMarketplaceSubmissionFiles[0];
  const submissionChecksum = readFileSync(findFile(inputDirs, requiredMarketplaceSubmissionFiles[1]), "utf8");
  assert.match(submissionChecksum, new RegExp(`^[a-f0-9]{64}  ${escapeRegex(submissionArchive)}\\r?\\n?$`));
}

const label = standaloneOnly ? "standalone release artifact set" : includeOptionalPlugin ? "full release artifact set" : "app release artifact set";
console.log(`${label} ok: ${requiredFiles.length} files in ${inputDirs.join(", ")}`);

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function findFile(dirs, name) {
  const match = dirs.flatMap((dir) => listFiles(dir)).find((path) => basename(path) === name);
  assert.ok(match, `${name} should exist`);
  return match;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
