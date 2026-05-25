#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "codex-swarm-sync-source-"));
const expected = "https://github.com/alex/codex-dashboard";

try {
  mkdirSync(join(temp, "scripts"), { recursive: true });
  mkdirSync(join(temp, "plugins/codex-swarm-monitor/.codex-plugin"), { recursive: true });
  cpSync(join(root, "scripts/sync-plugin-release-source.mjs"), join(temp, "scripts/sync-plugin-release-source.mjs"));
  writeFileSync(
    join(temp, "package.json"),
    `${JSON.stringify({
      name: "codex-swarm-monitor",
      version: "0.1.0",
      repository: { type: "git", url: "https://github.com/old/old.git" },
      homepage: "https://github.com/old/old"
    }, null, 2)}\n`
  );
  writeFileSync(
    join(temp, "plugins/codex-swarm-monitor/.codex-plugin/plugin.json"),
    `${JSON.stringify({
      name: "codex-swarm-monitor",
      version: "0.1.0",
      repository: "https://github.com/old/old",
      homepage: "https://github.com/old/old",
      interface: {
        websiteURL: "https://github.com/old/old",
        privacyPolicyURL: "https://github.com/old/old/blob/main/privacy.md",
        termsOfServiceURL: "https://github.com/old/old/blob/main/LICENSE"
      }
    }, null, 2)}\n`
  );

  const output = execFileSync(
    process.execPath,
    [join(temp, "scripts/sync-plugin-release-source.mjs"), "--repo", "git@github.com:alex/codex-dashboard.git"],
    { cwd: temp, encoding: "utf8" }
  );
  const result = JSON.parse(output);
  const packageJson = JSON.parse(readFileSync(join(temp, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(temp, "plugins/codex-swarm-monitor/.codex-plugin/plugin.json"), "utf8"));

  assert.equal(result.ok, true);
  assert.equal(result.repository, expected);
  assert.equal(packageJson.repository.url, `${expected}.git`);
  assert.equal(packageJson.homepage, expected);
  assert.equal(plugin.repository, expected);
  assert.equal(plugin.homepage, expected);
  assert.equal(plugin.interface.websiteURL, expected);
  assert.equal(plugin.interface.privacyPolicyURL, `${expected}/blob/main/docs/privacy.md`);
  assert.equal(plugin.interface.termsOfServiceURL, `${expected}/blob/main/LICENSE`);

  assert.throws(
    () =>
      execFileSync(process.execPath, [join(temp, "scripts/sync-plugin-release-source.mjs"), "--repo", "not-a-github-url"], {
        cwd: temp,
        encoding: "utf8",
        stdio: "pipe"
      }),
    /Missing GitHub repo/
  );

  console.log("sync release source smoke ok");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
