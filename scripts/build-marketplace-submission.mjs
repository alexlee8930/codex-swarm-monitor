#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const distRoot = join(root, "dist");
const packageJson = readJson(join(root, "package.json"));
const pluginRoot = join(root, "plugins/codex-swarm-monitor");
const pluginJson = readJson(join(pluginRoot, ".codex-plugin/plugin.json"));
const submissionName = `${pluginJson.name}-marketplace-submission-${pluginJson.version}`;
const submissionRoot = join(distRoot, submissionName);
const archivePath = join(distRoot, `${submissionName}.tar.gz`);
const checksumPath = `${archivePath}.sha256`;
const pluginArchiveName = `${pluginJson.name}-plugin-${pluginJson.version}.tar.gz`;
const pluginChecksumName = `${pluginArchiveName}.sha256`;

execFileSync(process.execPath, ["scripts/build-plugin-package.mjs"], { cwd: root, stdio: "pipe" });

rmSync(submissionRoot, { recursive: true, force: true });
rmSync(archivePath, { force: true });
rmSync(checksumPath, { force: true });
mkdirSync(join(submissionRoot, "assets"), { recursive: true });

const releaseAssets = releaseAssetManifest();
const submission = {
  name: pluginJson.name,
  displayName: pluginJson.interface.displayName,
  version: pluginJson.version,
  packageVersion: packageJson.version,
  userPromise: "Codex only. End users do not install Node, npm, Bun, OMX, or this source checkout.",
  installCommand: "codex plugin add codex-swarm-monitor@codex-swarm-monitor",
  startPrompt: "Start the Codex Swarm Monitor for this workspace.",
  dataBoundary: {
    hostedService: false,
    telemetry: false,
    mockData: false,
    remoteAvatarProvider: false,
    storage: "Local SQLite",
    transport: "Localhost workspace-scoped SSE with Last-Event-ID replay"
  },
  artifacts: {
    pluginArchive: pluginArchiveName,
    pluginChecksum: pluginChecksumName,
    screenshot: "assets/dashboard-desktop.png",
    releaseAssets
  },
  verification: [
    "npm run verify",
    "npm run release:artifacts -- dist",
    "npm run release:remote-smoke",
    "CODEX_SWARM_REQUIRE_CODEX_PLUGIN_SMOKE=1 npm run codex-plugin:smoke",
    "npm run marketplace:submission:smoke",
    "codex plugin add codex-swarm-monitor@codex-swarm-monitor"
  ]
};

cpSync(join(distRoot, pluginArchiveName), join(submissionRoot, pluginArchiveName));
cpSync(join(distRoot, pluginChecksumName), join(submissionRoot, pluginChecksumName));
cpSync(join(pluginRoot, "MARKETPLACE.md"), join(submissionRoot, "MARKETPLACE.md"));
cpSync(join(pluginRoot, ".codex-plugin/plugin.json"), join(submissionRoot, "plugin.json"));
cpSync(join(pluginRoot, "assets/screenshots/dashboard-desktop.png"), join(submissionRoot, "assets/dashboard-desktop.png"));
writeFileSync(join(submissionRoot, "submission.json"), `${JSON.stringify(submission, null, 2)}\n`);
writeFileSync(join(submissionRoot, "release-assets.json"), `${JSON.stringify(releaseAssets, null, 2)}\n`);
writeFileSync(join(submissionRoot, "SUBMISSION.md"), submissionMarkdown(submission));

execFileSync("tar", ["-czf", archivePath, "-C", distRoot, submissionName], { stdio: "pipe" });
const checksum = sha256(archivePath);
writeFileSync(checksumPath, `${checksum}  ${basename(archivePath)}\n`);

assert.ok(statSync(archivePath).size > 100_000, "marketplace submission should include screenshot and plugin archive");
assert.equal(readFileSync(checksumPath, "utf8").trim(), `${checksum}  ${basename(archivePath)}`);
assert.equal(existsSync(join(submissionRoot, "submission.json")), true);
assert.equal(existsSync(join(submissionRoot, pluginArchiveName)), true);

console.log(JSON.stringify({
  name: pluginJson.name,
  version: pluginJson.version,
  archive: `dist/${basename(archivePath)}`,
  checksumFile: `dist/${basename(checksumPath)}`,
  checksum,
  releaseAssetCount: releaseAssets.length
}, null, 2));

function releaseAssetManifest() {
  const names = [
    "codex-swarm-monitor-linux-x64.tar.gz",
    "codex-swarm-monitor-linux-x64.tar.gz.sha256",
    "codex-swarm-monitor-darwin-arm64.tar.gz",
    "codex-swarm-monitor-darwin-arm64.tar.gz.sha256",
    "codex-swarm-monitor-darwin-x64.tar.gz",
    "codex-swarm-monitor-darwin-x64.tar.gz.sha256",
    "codex-swarm-monitor-win32-x64.tar.gz",
    "codex-swarm-monitor-win32-x64.tar.gz.sha256",
    pluginArchiveName,
    pluginChecksumName
  ];
  return names.map((name) => {
    const path = findReleaseAsset(name);
    assert.equal(existsSync(path), true, `${name} must exist before building marketplace submission`);
    return {
      name,
      size: statSync(path).size,
      sha256: sha256(path)
    };
  });
}

function findReleaseAsset(name) {
  const roots = [distRoot, join(root, "release-artifacts")];
  return roots.flatMap((dir) => listFiles(dir)).find((path) => basename(path) === name) || join(distRoot, name);
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function submissionMarkdown(submission) {
  return `# ${submission.displayName} Marketplace Submission

## User Promise

${submission.userPromise}

## Install

\`\`\`bash
${submission.installCommand}
\`\`\`

Then ask Codex:

\`\`\`text
${submission.startPrompt}
\`\`\`

## Data Boundary

- No hosted service
- No telemetry
- No demo or seed events
- No remote avatar provider
- Local SQLite event store
- Localhost-only SSE with Last-Event-ID replay
- Secrets redacted before persistence and broadcast

## Included Artifacts

- \`${submission.artifacts.pluginArchive}\`
- \`${submission.artifacts.pluginChecksum}\`
- \`${submission.artifacts.screenshot}\`
- \`plugin.json\`
- \`submission.json\`
- \`release-assets.json\`
- \`MARKETPLACE.md\`

## Verification

${submission.verification.map((command) => `- \`${command}\``).join("\n")}
`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
