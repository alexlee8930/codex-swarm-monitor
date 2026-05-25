import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatReleaseReadiness, releaseReadiness } from "../apps/backend/src/release-readiness.mjs";

test("release readiness text includes actionable release checklist", () => {
  const summary = releaseReadiness(undefined, { inspectPublished: false });
  const output = formatReleaseReadiness(summary);

  assert.match(output, /Codex Swarm Monitor release readiness \(v0\.1\.0\)/);
  assert.match(output, /Release checklist/);
  assert.match(output, /\[ready\] Verify local product gate/);
  assert.match(output, /npm run verify/);
  assert.match(output, /git tag v0\.1\.0 && git push origin HEAD v0\.1\.0/);
  assert.match(output, /npm run standalone:build:all/);
  assert.match(output, /official Node runtimes/);
  assert.doesNotMatch(output, /--name release-artifacts/);
  assert.match(output, /npm run release:artifacts -- dist/);
  assert.match(output, /gh release create v0\.1\.0 \$\(find dist -maxdepth 1 -type f/);
  assert.match(output, /gh release upload v0\.1\.0 \$\(find dist -maxdepth 1 -type f/);
  assert.match(output, /--clobber/);
  assert.match(output, /-name '\*\.tar\.gz'/);
  assert.match(output, /-name '\*\.sha256'/);
  assert.match(output, /--title v0\.1\.0/);
  assert.match(output, /codex-marketplace-publication/);
  assert.match(output, /plugin-release-source/);
  assert.match(output, /Sync plugin release source/);
  assert.match(output, /npm run release:sync-source/);
  assert.match(output, /Optional Codex marketplace plugin/);
  assert.match(output, /Optional Codex plugin package/);
  assert.match(output, /Optional Codex marketplace submission/);
  assert.match(output, /codex plugin add codex-swarm-monitor@codex-swarm-monitor/);
  assert.doesNotMatch(output, /gh release create v0\.1\.0 dist\/\*/);
});

test("release readiness recognizes nested GitHub artifact downloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-release-artifacts-"));
  try {
    writeFileSync(join(dir, "package.json"), `${JSON.stringify({ version: "0.1.0" })}\n`);
    const archives = [
      "codex-swarm-monitor-linux-x64.tar.gz",
      "codex-swarm-monitor-darwin-arm64.tar.gz",
      "codex-swarm-monitor-darwin-x64.tar.gz",
      "codex-swarm-monitor-win32-x64.tar.gz",
      "codex-swarm-monitor-darwin-arm64.app.tar.gz",
      "codex-swarm-monitor-darwin-x64.app.tar.gz"
    ];
    for (const archive of archives) {
      const folder = join(dir, "dist", archive.replace(".tar.gz", ""));
      await mkdir(folder, { recursive: true });
      writeFileSync(join(folder, archive), "archive");
      writeFileSync(join(folder, `${archive}.sha256`), "checksum");
    }
    const pluginFolder = join(dir, "dist", "codex-swarm-monitor-plugin");
    await mkdir(pluginFolder, { recursive: true });
    writeFileSync(join(pluginFolder, "codex-swarm-monitor-plugin-0.1.0.tar.gz"), "plugin");
    writeFileSync(join(pluginFolder, "codex-swarm-monitor-plugin-0.1.0.tar.gz.sha256"), "plugin checksum");
    const submissionFolder = join(dir, "dist", "codex-swarm-monitor-marketplace-submission");
    await mkdir(submissionFolder, { recursive: true });
    writeFileSync(join(submissionFolder, "codex-swarm-monitor-marketplace-submission-0.1.0.tar.gz"), "submission");
    writeFileSync(join(submissionFolder, "codex-swarm-monitor-marketplace-submission-0.1.0.tar.gz.sha256"), "submission checksum");

    const summary = releaseReadiness(dir, { inspectPublished: false });
    assert.equal(summary.checks.find((item) => item.id === "standalone-archives").ok, true);
    assert.equal(summary.checks.find((item) => item.id === "standalone-checksums").ok, true);
    assert.equal(summary.checks.find((item) => item.id === "desktop-apps").ok, true);
    assert.equal(summary.checks.find((item) => item.id === "desktop-app-checksums").ok, true);
    assert.equal(summary.checks.find((item) => item.id === "plugin-package").ok, true);
    assert.equal(summary.checks.find((item) => item.id === "plugin-package").optional, true);
    assert.equal(summary.checks.find((item) => item.id === "marketplace-submission").ok, true);
    assert.equal(summary.checks.find((item) => item.id === "marketplace-submission").optional, true);
    assert.equal(summary.checks.find((item) => item.id === "codex-marketplace-publication").ok, false);
    assert.equal(summary.checks.find((item) => item.id === "codex-marketplace-publication").optional, true);
    assert.equal(summary.plan.find((item) => item.id === "collect-artifacts").state, "done");
    assert.equal(summary.plan.find((item) => item.id === "verify-release-assets").state, "ready");
    assert.equal(summary.plan.find((item) => item.id === "publish-codex-marketplace").state, "ready");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release readiness can record externally verified Codex marketplace publication", () => {
  const summary = releaseReadiness(undefined, { inspectPublished: false, marketplacePublished: true });
  assert.equal(summary.checks.find((item) => item.id === "codex-marketplace-publication").ok, true);
  assert.equal(summary.plan.find((item) => item.id === "publish-codex-marketplace").state, "done");
});

test("release readiness requires plugin release source to match git origin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-release-source-"));
  try {
    writeFileSync(join(dir, "package.json"), `${JSON.stringify({ version: "0.1.0" })}\n`);
    await mkdir(join(dir, "plugins/codex-swarm-monitor/.codex-plugin"), { recursive: true });
    writeFileSync(
      join(dir, "plugins/codex-swarm-monitor/.codex-plugin/plugin.json"),
      `${JSON.stringify({
        repository: "https://github.com/alex/codex-swarm-monitor",
        homepage: "https://github.com/alex/codex-swarm-monitor",
        interface: {
          websiteURL: "https://github.com/alex/codex-swarm-monitor",
          privacyPolicyURL: "https://github.com/alex/codex-swarm-monitor/blob/main/docs/privacy.md",
          termsOfServiceURL: "https://github.com/alex/codex-swarm-monitor/blob/main/LICENSE"
        }
      })}\n`
    );
    await mkdir(join(dir, ".git"), { recursive: true });
    const summary = releaseReadiness(dir, { inspectPublished: false });
    assert.equal(summary.checks.find((item) => item.id === "plugin-release-source").ok, false);
    assert.equal(summary.checks.find((item) => item.id === "plugin-release-source").optional, true);
    assert.match(summary.checks.find((item) => item.id === "plugin-release-source").remediation, /Configure the public GitHub origin first/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
