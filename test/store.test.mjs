import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStore } from "../apps/backend/src/store.mjs";

test("store records events and derives agent/file state", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-store-"));
  const store = openStore(join(dir, "events.sqlite"));
  try {
    store.append({
      type: "agent_spawn",
      agent_id: "hermes-123abc",
      role: "Explorer",
      task: "Read docs",
      parent: "main"
    });
    store.append({
      type: "file_read",
      agent_id: "hermes-123abc",
      path: "prd.md"
    });

    const state = store.state();
    assert.equal(state.metrics.totalEvents, 2);
    assert.equal(state.metrics.activeAgents, 1);
    assert.equal(state.metrics.mdFiles, 1);
    assert.equal(state.agents[0].id, "hermes-123abc");
    assert.deepEqual(state.agents[0].mdFiles, ["prd.md"]);
    assert.match(state.agents[0].avatar, /\/avatar\?name=Hermes&role=Explorer&backgroundColor=ffd5dc&v=7/);
    assert.equal(state.edges[0].source, "main");
    assert.equal(state.edges[0].target, "hermes-123abc");
    assert.equal(state.agents[0].parent, "main");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store redacts secrets before persisting hook payloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-store-redact-"));
  const store = openStore(join(dir, "events.sqlite"));
  try {
    store.append({
      type: "post_tool_use",
      agent_id: "main",
      command: "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456 codex",
      prompt: "use Bearer abcdefghijklmnopqrstuvwxyz012345 token",
      tool_input: {
        authorization: "Bearer abcdefghijklmnopqrstuvwxyz012345",
        nested: {
          github_token: "ghp_abcdefghijklmnopqrstuvwxyz123456"
        }
      },
      raw: {
        password: "do-not-store",
        value: "plain text"
      },
      tokens: 42
    });

    const event = store.list(1)[0];
    assert.equal(event.payload.command, `OPENAI_API_KEY=[redacted] codex`);
    assert.equal(event.payload.prompt, "use Bearer [redacted] token");
    assert.equal(event.payload.tool_input.authorization, "[redacted]");
    assert.equal(event.payload.tool_input.nested.github_token, "[redacted]");
    assert.equal(event.payload.raw.password, "[redacted]");
    assert.equal(event.payload.raw.value, "plain text");
    assert.equal(event.payload.tokens, 42);
    assert.doesNotMatch(JSON.stringify(event.payload), /sk-proj|ghp_|do-not-store|abcdefghijklmnopqrstuvwxyz012345/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store can derive state for one selected workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-store-workspace-"));
  const store = openStore(join(dir, "events.sqlite"));
  try {
    const first = join(dir, "first");
    const second = join(dir, "second");
    store.append({ type: "file_read", agent_id: "main", path: "AGENTS.md", cwd: first });
    store.append({ type: "file_read", agent_id: "other", path: "RALPH.md", cwd: second });

    const state = store.state({ workspace: first });
    assert.equal(store.count(), 2);
    assert.equal(state.metrics.totalEvents, 1);
    assert.equal(state.metrics.storedEvents, 1);
    assert.equal(state.agents[0].id, "main");
    assert.equal(state.files[0].path, "AGENTS.md");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store can replay events after an SSE last event id", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-store-replay-"));
  const store = openStore(join(dir, "events.sqlite"));
  try {
    const selected = join(dir, "selected");
    const other = join(dir, "other");
    const first = store.append({ type: "file_read", agent_id: "main", path: "one.md", cwd: selected });
    store.append({ type: "file_read", agent_id: "other", path: "noise.md", cwd: other });
    const second = store.append({ type: "file_read", agent_id: "main", path: "two.md", cwd: selected });

    assert.equal(store.latestId({ workspace: selected }), second.id);
    assert.deepEqual(store.after(first.id, 10, { workspace: selected }).map((event) => event.payload.path), ["two.md"]);
    assert.deepEqual(store.after(first.id, 10).map((event) => event.payload.path), ["noise.md", "two.md"]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store keeps MCP spawner lifecycle events visible for the selected workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-store-spawner-workspace-"));
  const store = openStore(join(dir, "events.sqlite"));
  try {
    const selected = join(dir, "selected");
    const other = join(dir, "other");
    store.append({
      type: "agent_spawn",
      agent_id: "explorer-123abc",
      role: "Explorer",
      task: "Map Ralph loop files",
      parent: "main",
      cwd: selected,
      workspace_root: selected
    });
    store.append({
      type: "agent_complete",
      agent_id: "explorer-123abc",
      result_length: 120,
      cwd: selected,
      workspace_root: selected
    });
    store.append({
      type: "agent_spawn",
      agent_id: "reviewer-999999",
      role: "Reviewer",
      task: "Unrelated workspace",
      parent: "main",
      cwd: other,
      workspace_root: other
    });

    const state = store.state({ workspace: selected });
    assert.equal(state.metrics.totalEvents, 2);
    assert.equal(state.metrics.storedEvents, 2);
    assert.equal(state.agents.length, 1);
    assert.equal(state.agents[0].id, "explorer-123abc");
    assert.equal(state.agents[0].role, "Explorer");
    assert.equal(state.edges[0].source, "main");
    assert.equal(state.edges[0].target, "explorer-123abc");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store filters workspace events before applying the state limit", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-store-filter-limit-"));
  const store = openStore(join(dir, "events.sqlite"));
  try {
    const selected = join(dir, "selected");
    const noisy = join(dir, "noisy");
    store.append({ type: "file_read", agent_id: "selected", path: "AGENTS.md", cwd: selected });
    for (let index = 0; index < 1200; index += 1) {
      store.append({ type: "file_read", agent_id: `noisy-${index}`, path: "noise.md", cwd: noisy });
    }

    const state = store.state({ workspace: selected });
    assert.equal(state.metrics.totalEvents, 1);
    assert.equal(state.metrics.storedEvents, 1);
    assert.equal(state.agents[0].id, "selected");
    assert.equal(state.files[0].path, "AGENTS.md");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store can clear only one selected workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-store-clear-scope-"));
  const store = openStore(join(dir, "events.sqlite"));
  try {
    const first = join(dir, "first");
    const second = join(dir, "second");
    store.append({ type: "file_read", agent_id: "first", path: "AGENTS.md", cwd: first });
    store.append({ type: "file_read", agent_id: "second", path: "RALPH.md", cwd: second });

    store.clear({ workspace: first });

    assert.equal(store.count(), 1);
    assert.equal(store.state({ workspace: first }).metrics.totalEvents, 0);
    assert.equal(store.state({ workspace: second }).metrics.totalEvents, 1);
    assert.equal(store.state({ workspace: second }).files[0].path, "RALPH.md");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store applies event retention policy", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-store-retention-"));
  const store = openStore({ dbPath: join(dir, "events.sqlite"), maxEvents: 2 });
  try {
    store.append({ type: "file_read", agent_id: "main", path: "one.md" });
    store.append({ type: "file_read", agent_id: "main", path: "two.md" });
    store.append({ type: "file_read", agent_id: "main", path: "three.md" });

    const state = store.state();
    assert.equal(store.count(), 2);
    assert.equal(state.metrics.storedEvents, 2);
    assert.equal(state.metrics.retentionMaxEvents, 2);
    assert.equal(state.retention.policy, "keep latest 2 events");
    assert.deepEqual(state.events.map((event) => event.payload.path), ["two.md", "three.md"]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store updates event retention policy at runtime", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-store-retention-update-"));
  const store = openStore({ dbPath: join(dir, "events.sqlite"), maxEvents: 0 });
  try {
    store.append({ type: "file_read", agent_id: "main", path: "one.md" });
    store.append({ type: "file_read", agent_id: "main", path: "two.md" });
    store.append({ type: "file_read", agent_id: "main", path: "three.md" });

    const retention = store.setRetention(1);
    const state = store.state();
    assert.equal(retention.maxEvents, 1);
    assert.equal(state.metrics.storedEvents, 1);
    assert.deepEqual(state.events.map((event) => event.payload.path), ["three.md"]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
