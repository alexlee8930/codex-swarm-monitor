import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CODEX_HOOK_EVENTS, analyzeWorkspace, installWorkspace, uninstallWorkspace } from "../apps/backend/src/workspace.mjs";

test("analyzeWorkspace summarizes Codex/Ralph artifacts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-workspace-"));
  try {
    await mkdir(join(dir, ".codex"), { recursive: true });
    await mkdir(join(dir, ".codex/agents"), { recursive: true });
    await mkdir(join(dir, ".codex/prompts"), { recursive: true });
    await mkdir(join(dir, ".omx/logs"), { recursive: true });
    await mkdir(join(dir, ".omx/state"), { recursive: true });
    await mkdir(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "# Agents\n\n## Rules\n");
    writeFileSync(
      join(dir, "prd.md"),
      "# PRD\n\n## Current Implementation Update\n1. Observability challenge narrative\n\n## Follow-Up Scope\n1. Harden release readiness\n"
    );
    writeFileSync(
      join(dir, "RALPH.md"),
      "# Ralph\n\n## Success Criteria\n- [SC-1] Hook events reach the monitor | Verification: test green\n- [ ] Verification command passes\n\n## Verification Commands\n```bash\nnpm test\ncurl -fsS http://127.0.0.1:4000/health\n```\n"
    );
    writeFileSync(join(dir, "IMPLEMENTATION_PLAN.md"), "# Plan\n\n- [x] Task 001: Install hooks\n- [ ] Task 002: Stream events\n\n## Follow-Up Scope\n1. Publish release artifacts\n");
    writeFileSync(join(dir, ".git/HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(dir, ".git/config"), "[remote \"origin\"]\n  url = git@github.com:alex/codex-swarm-monitor.git\n");
    writeFileSync(join(dir, ".codex/agents/reviewer.toml"), "name = \"reviewer\"\n");
    writeFileSync(join(dir, ".codex/prompts/reviewer.md"), "# Reviewer\n");
    writeFileSync(join(dir, ".codex/config.toml"), "[mcp_servers.example]\ncommand = \"node\"\n");
    writeFileSync(join(dir, ".codex/hooks.json"), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "node hook.mjs" }] }] } }));
    writeFileSync(join(dir, ".omx/logs/run.md"), "# Log\n");
    writeFileSync(join(dir, ".omx/state/native-stop-state.json"), "{}\n");

    const workspace = await analyzeWorkspace(dir);

    assert.equal(workspace.detected.codex, true);
    assert.equal(workspace.repository.hasGit, true);
    assert.equal(workspace.repository.branch, "main");
    assert.equal(workspace.repository.remote, "github.com/alex/codex-swarm-monitor");
    assert.equal(workspace.detected.hooks, true);
    assert.equal(workspace.detected.mcp, true);
    assert.equal(workspace.detected.ralph, true);
    assert.equal(workspace.counts.markdown, 6);
    assert.ok(workspace.hierarchy.some((node) => node.label === "Codex harness"));
    assert.equal(workspace.harness.summary.find((item) => item.id === "agents").value, 1);
    assert.equal(workspace.harness.summary.find((item) => item.id === "prompts").value, 1);
    assert.equal(workspace.harness.summary.find((item) => item.id === "hooks").value, 1);
    assert.equal(workspace.harness.summary.find((item) => item.id === "mcp").value, 1);
    assert.equal(workspace.harness.loops.find((item) => item.label === "Runtime logs").active, true);
    assert.equal(workspace.harness.loops.find((item) => item.label === "State snapshots").active, true);
    assert.equal(workspace.harness.stages.find((item) => item.id === "instructions").state, "active");
    assert.equal(workspace.harness.stages.find((item) => item.id === "agents-prompts").state, "active");
    assert.equal(workspace.harness.stages.find((item) => item.id === "hooks-mcp").state, "active");
    assert.equal(workspace.harness.stages.find((item) => item.id === "runtime-evidence").state, "active");
    assert.equal(workspace.harness.stages.find((item) => item.id === "acceptance-loop").state, "active");
    assert.equal(workspace.harness.ralph.successCriteria[0].id, "SC-1");
    assert.equal(workspace.harness.ralph.successCriteria[0].label, "Hook events reach the monitor");
    assert.deepEqual(
      workspace.harness.ralph.tasks.map((item) => item.label),
      ["Task 001: Install hooks", "Task 002: Stream events", "Publish release artifacts", "Harden release readiness"]
    );
    assert.deepEqual(new Set(workspace.harness.ralph.tasks.map((item) => item.id)).size, workspace.harness.ralph.tasks.length);
    assert.equal(workspace.harness.ralph.tasks.some((item) => item.label === "Observability challenge narrative"), false);
    assert.deepEqual(
      workspace.harness.ralph.verificationCommands.map((item) => item.command),
      ["npm test", "curl -fsS http://127.0.0.1:4000/health"]
    );
    assert.deepEqual(
      workspace.harness.stages.map((item) => item.label),
      ["Instructions", "Agents & prompts", "Hooks & MCP", "Runtime evidence", "Acceptance loop"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installWorkspace writes a self-contained project-local Codex hook", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-install-"));
  try {
    const workspace = await installWorkspace(dir, "http://127.0.0.1:4999");
    const hooksJson = JSON.parse(readFileSync(join(dir, ".codex/hooks.json"), "utf8"));

    assert.equal(workspace.install.configured, true);
    assert.deepEqual(workspace.harness.hooks.swarmEvents, CODEX_HOOK_EVENTS);
    assert.deepEqual(workspace.harness.hooks.missingSwarmEvents, []);
    assert.equal(workspace.detected.codex, true);
    assert.equal(workspace.detected.hooks, true);
    assert.equal(workspace.detected.mcp, false);
    assert.equal(existsSync(join(dir, ".codex/codex-swarm-monitor/hook.mjs")), true);
    assert.equal(workspace.trust.eventBusUrl, "http://127.0.0.1:4999");
    for (const eventName of CODEX_HOOK_EVENTS) {
      const command = hooksJson.hooks[eventName][0].hooks.find((hook) => hook.command.includes("codex-swarm-monitor/hook.mjs"))?.command;
      assert.match(command, new RegExp(`codex-swarm-monitor\\/hook\\.mjs" ${eventName}$`));
    }
    assert.doesNotMatch(readFileSync(join(dir, ".codex/codex-swarm-monitor/hook.mjs"), "utf8"), /Users\/yuchanlee\/codex_dashboard/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installWorkspace preserves existing hooks while requiring complete swarm coverage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-install-preserve-"));
  try {
    await mkdir(join(dir, ".codex"), { recursive: true });
    writeFileSync(
      join(dir, ".codex/hooks.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { hooks: [{ type: "command", command: "node keep-post.mjs" }] },
            { hooks: [{ type: "command", command: "node keep-second-group.mjs" }] }
          ],
          Stop: [{ hooks: [] }]
        }
      })
    );

    const before = await analyzeWorkspace(dir);
    assert.equal(before.install.configured, false);
    assert.deepEqual(before.harness.hooks.swarmEvents, []);
    assert.deepEqual(before.harness.hooks.missingSwarmEvents, CODEX_HOOK_EVENTS);
    assert.equal(before.harness.hooks.events.includes("Stop"), false);

    const workspace = await installWorkspace(dir, "http://127.0.0.1:4999");
    const hooksJson = JSON.parse(readFileSync(join(dir, ".codex/hooks.json"), "utf8"));

    assert.equal(workspace.install.configured, true);
    assert.equal(workspace.trust.eventBusUrl, "http://127.0.0.1:4999");
    assert.deepEqual(workspace.harness.hooks.swarmEvents, CODEX_HOOK_EVENTS);
    assert.equal(hooksJson.hooks.PostToolUse[0].hooks.some((hook) => hook.command === "node keep-post.mjs"), true);
    assert.equal(hooksJson.hooks.PostToolUse[1].hooks.some((hook) => hook.command === "node keep-second-group.mjs"), true);
    for (const eventName of CODEX_HOOK_EVENTS) {
      assert.equal(
        hooksJson.hooks[eventName].some((group) => group.hooks.some((hook) => hook.command.includes("codex-swarm-monitor/hook.mjs"))),
        true,
        `${eventName} should contain the swarm monitor hook`
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installWorkspace can add the optional MCP spawner when requested", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-install-mcp-"));
  try {
    const workspace = await installWorkspace(dir, "http://127.0.0.1:4999", { includeMcp: true });

    assert.equal(workspace.install.configured, true);
    assert.equal(workspace.detected.mcp, true);
    assert.match(readFileSync(join(dir, ".codex/config.toml"), "utf8"), /agent_spawner/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uninstallWorkspace removes only Codex Swarm hooks and bundled runtime", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-uninstall-"));
  try {
    await mkdir(join(dir, ".codex"), { recursive: true });
    writeFileSync(
      join(dir, ".codex/hooks.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ hooks: [{ type: "command", command: "node existing-hook.mjs" }] }]
        }
      })
    );

    await installWorkspace(dir, "http://127.0.0.1:4999", { includeMcp: true });
    assert.match(readFileSync(join(dir, ".codex/hooks.json"), "utf8"), /codex-swarm-monitor\/hook\.mjs/);
    assert.equal(existsSync(join(dir, ".codex/codex-swarm-monitor/hook.mjs")), true);
    assert.match(readFileSync(join(dir, ".codex/config.toml"), "utf8"), /Codex Swarm Monitor MCP Server/);

    const workspace = await uninstallWorkspace(dir);
    const hooks = readFileSync(join(dir, ".codex/hooks.json"), "utf8");
    const config = readFileSync(join(dir, ".codex/config.toml"), "utf8");

    assert.equal(workspace.install.configured, false);
    assert.match(hooks, /existing-hook\.mjs/);
    assert.doesNotMatch(hooks, /codex-swarm-monitor\/hook\.mjs|codex-swarm-hook\.mjs/);
    assert.doesNotMatch(config, /Codex Swarm Monitor MCP Server|agent_spawner/);
    assert.equal(existsSync(join(dir, ".codex/codex-swarm-monitor/hook.mjs")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
