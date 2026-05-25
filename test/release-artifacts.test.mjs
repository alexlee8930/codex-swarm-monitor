import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("release artifact verifier separates standalone-only and full release checks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-release-verify-"));
  const standaloneDir = join(dir, "release-artifacts");
  const pluginDir = join(dir, "dist");
  try {
    const archives = [
      "codex-swarm-monitor-linux-x64.tar.gz",
      "codex-swarm-monitor-darwin-arm64.tar.gz",
      "codex-swarm-monitor-darwin-x64.tar.gz",
      "codex-swarm-monitor-win32-x64.tar.gz"
    ];
    for (const archive of archives) {
      await writeArtifactPair(join(standaloneDir, archive.replace(".tar.gz", "")), archive, 1_000_001);
    }

    assert.match(
      execFileSync(process.execPath, ["scripts/verify-release-artifacts.mjs", standaloneDir, "--standalone-only"], {
        cwd: root,
        encoding: "utf8"
      }),
      /standalone release artifact set ok/
    );

    assertVerifierFails(["scripts/verify-release-artifacts.mjs", standaloneDir], /codex-swarm-monitor-plugin-0\.1\.0\.tar\.gz/);

    await writeArtifactPair(pluginDir, "codex-swarm-monitor-plugin-0.1.0.tar.gz", 128);
    assertVerifierFails(["scripts/verify-release-artifacts.mjs", standaloneDir, pluginDir], /codex-swarm-monitor-marketplace-submission-0\.1\.0\.tar\.gz/);
    await writeArtifactPair(pluginDir, "codex-swarm-monitor-marketplace-submission-0.1.0.tar.gz", 128);
    assert.match(
      execFileSync(process.execPath, ["scripts/verify-release-artifacts.mjs", standaloneDir, pluginDir], {
        cwd: root,
        encoding: "utf8"
      }),
      /release artifact set ok: 12 files/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function assertVerifierFails(args, pattern) {
  try {
    execFileSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.fail("verifier should fail");
  } catch (error) {
    assert.match(`${error.stdout || ""}${error.stderr || ""}${error.message || ""}`, pattern);
  }
}

async function writeArtifactPair(dir, name, size) {
  await mkdir(dir, { recursive: true });
  const artifactPath = join(dir, name);
  const content = Buffer.alloc(size, "x");
  writeFileSync(artifactPath, content);
  writeFileSync(join(dir, `${name}.sha256`), `${sha256(content)}  ${name}\n`);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
