import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { folderPickerCommand } from "../apps/backend/src/folder-picker.mjs";
import { createSwarmServer } from "../apps/backend/src/server.mjs";
import { openStore } from "../apps/backend/src/store.mjs";

test("server accepts events and exposes state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-server-"));
  const store = openStore(join(dir, "events.sqlite"));
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const post = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "file_read", agent_id: "athena-1", path: "AGENTS.md" })
    });
    assert.equal(post.status, 201);

    const state = await (await fetch(`${base}/state`)).json();
    assert.equal(state.metrics.totalEvents, 1);
    assert.equal(state.metrics.storedEvents, 1);
    assert.equal(state.retention.maxEvents, 50000);
    assert.equal(state.files[0].path, "AGENTS.md");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server only grants CORS to same-origin localhost callers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-server-origin-"));
  const store = openStore(join(dir, "events.sqlite"));
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const allowed = await fetch(`${base}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: base
      },
      body: JSON.stringify({ type: "file_read", agent_id: "main", path: "AGENTS.md" })
    });
    assert.equal(allowed.status, 201);
    assert.equal(allowed.headers.get("access-control-allow-origin"), base);

    const blocked = await fetch(`${base}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com"
      },
      body: JSON.stringify({ type: "file_read", agent_id: "main", path: "RALPH.md" })
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);

    const state = await (await fetch(`${base}/state`)).json();
    assert.equal(state.metrics.totalEvents, 1);
    assert.equal(state.files[0].path, "AGENTS.md");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server state and stream are scoped to the selected workspace path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-server-scope-"));
  const store = openStore(join(dir, "events.sqlite"));
  const first = join(dir, "first");
  const second = join(dir, "second");
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const abort = new AbortController();

  try {
    await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "file_read", agent_id: "first", path: "AGENTS.md", cwd: first })
    });
    await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "file_read", agent_id: "second", path: "RALPH.md", cwd: second })
    });

    const scopedState = await (await fetch(`${base}/state?path=${encodeURIComponent(first)}`)).json();
    assert.equal(scopedState.metrics.totalEvents, 1);
    assert.equal(scopedState.metrics.storedEvents, 1);
    assert.equal(scopedState.agents[0].id, "first");
    assert.equal(scopedState.files[0].path, "AGENTS.md");

    const streamPromise = readSseUntil(
      `${base}/stream?path=${encodeURIComponent(first)}`,
      (message) => message.state?.metrics?.totalEvents === 2,
      abort.signal
    );
    await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "file_read", agent_id: "first", path: "prd.md", cwd: first })
    });
    const streamMessage = await streamPromise;
    assert.deepEqual(streamMessage.state.files.map((file) => file.path).sort(), ["AGENTS.md", "prd.md"]);
  } finally {
    abort.abort();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server clears events only for the selected workspace path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-server-clear-scope-"));
  const store = openStore(join(dir, "events.sqlite"));
  const first = join(dir, "first");
  const second = join(dir, "second");
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "file_read", agent_id: "first", path: "AGENTS.md", cwd: first })
    });
    await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "file_read", agent_id: "second", path: "RALPH.md", cwd: second })
    });

    await fetch(`${base}/events?path=${encodeURIComponent(first)}`, { method: "DELETE" });

    const firstState = await (await fetch(`${base}/state?path=${encodeURIComponent(first)}`)).json();
    const secondState = await (await fetch(`${base}/state?path=${encodeURIComponent(second)}`)).json();
    assert.equal(firstState.metrics.totalEvents, 0);
    assert.equal(secondState.metrics.totalEvents, 1);
    assert.equal(secondState.files[0].path, "RALPH.md");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server updates retention settings and prunes stored events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-server-retention-"));
  const store = openStore({ dbPath: join(dir, "events.sqlite"), maxEvents: 0 });
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    for (const path of ["one.md", "two.md", "three.md"]) {
      const post = await fetch(`${base}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "file_read", agent_id: "main", path })
      });
      assert.equal(post.status, 201);
    }

    const update = await (
      await fetch(`${base}/settings/retention`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxEvents: 2 })
      })
    ).json();
    const state = await (await fetch(`${base}/state`)).json();
    assert.equal(update.retention.maxEvents, 2);
    assert.equal(state.metrics.storedEvents, 2);
    assert.deepEqual(state.events.map((event) => event.payload.path), ["two.md", "three.md"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server analyzes and connects a selected workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-server-workspace-"));
  const store = openStore(join(dir, "events.sqlite"));
  const target = join(dir, "target");
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(target, { recursive: true }));
    writeFileSync(join(target, "AGENTS.md"), "# Agents\n");

    const analyzed = await (await fetch(`${base}/workspace/analyze?path=${encodeURIComponent(target)}`)).json();
    assert.equal(analyzed.detected.agents, true);
    assert.equal(analyzed.counts.markdown, 1);
    assert.match(analyzed.trust.firstRunNotice, /trust this workspace hook/);

    const connected = await (
      await fetch(`${base}/workspace/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target })
      })
    ).json();
    assert.equal(connected.install.configured, true);
    assert.equal(connected.detected.hooks, true);
    assert.equal(connected.detected.mcp, false);
    assert.equal(connected.trust.hookPath, join(target, ".codex/codex-swarm-monitor/hook.mjs"));
    assert.equal(connected.trust.eventBusUrl, base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server disconnects a selected workspace without clearing unrelated hooks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-server-disconnect-"));
  const store = openStore(join(dir, "events.sqlite"));
  const target = join(dir, "target");
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(target, ".codex"), { recursive: true }));
    writeFileSync(join(target, ".codex/hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node keep-me.mjs" }] }] } }));

    const connected = await (
      await fetch(`${base}/workspace/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target })
      })
    ).json();
    assert.equal(connected.install.configured, true);

    const disconnected = await (
      await fetch(`${base}/workspace/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target })
      })
    ).json();
    const hooks = JSON.parse(await readFile(join(target, ".codex/hooks.json"), "utf8"));

    assert.equal(disconnected.install.configured, false);
    assert.equal(hooks.hooks.Stop[0].hooks[0].command, "node keep-me.mjs");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server exposes system readiness", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-system-"));
  const store = openStore(join(dir, "events.sqlite"));
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const system = await (await fetch(`http://127.0.0.1:${port}/system`)).json();
    assert.equal(system.node.ok, true);
    assert.equal(system.runtime.ok, true);
    assert.match(system.runtime.label, /runtime/);
    assert.equal(typeof system.codex.ok, "boolean");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server exposes release readiness with actionable remediation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-release-readiness-"));
  const store = openStore(join(dir, "events.sqlite"));
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const release = await (await fetch(`http://127.0.0.1:${port}/release/readiness`)).json();
    assert.equal(release.version, "0.1.0");
    assert.equal(release.tag, "v0.1.0");
    assert.equal(typeof release.strictOk, "boolean");
    assert.ok(release.checks.some((item) => item.id === "standalone-archives"));
    assert.ok(release.checks.some((item) => item.id === "published-release-assets"));
    assert.ok(release.checks.every((item) => item.ok || item.remediation));
    assert.ok(release.plan.some((item) => item.id === "verify-source" && item.command === "npm run verify"));
    assert.ok(release.plan.some((item) => item.id === "collect-artifacts" && item.command === "npm run standalone:build:all"));
    assert.ok(release.plan.some((item) => item.id === "publish-github-release" && item.command.includes("gh release create v0.1.0")));
    assert.ok(release.plan.some((item) => item.id === "publish-github-release" && item.command.includes("find dist -maxdepth 1 -type f")));
    assert.ok(release.plan.some((item) => item.id === "publish-github-release" && item.command.includes("gh release upload v0.1.0")));
    assert.ok(release.plan.some((item) => item.id === "publish-github-release" && item.command.includes("--clobber")));
    assert.ok(release.plan.every((item) => !item.command.includes("gh release create v0.1.0 dist/*")));
    assert.ok(release.plan.every((item) => ["blocked", "done", "ready"].includes(item.state)));
    assert.deepEqual(
      release.blockers.map((item) => item.optional),
      release.blockers.map(() => false)
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server exposes a local support bundle without synthetic data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-support-"));
  const store = openStore(join(dir, "events.sqlite"));
  const workspace = join(dir, "workspace");
  const server = createSwarmServer({ store, defaultWorkspace: workspace });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace, { recursive: true }));
    writeFileSync(join(workspace, "AGENTS.md"), "# Agents\n");
    await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "file_read", agent_id: "main", path: "AGENTS.md", cwd: workspace, api_key: "sk-proj-secret1234567890" })
    });

    const bundle = await (await fetch(`${base}/support/bundle?path=${encodeURIComponent(workspace)}`)).json();
    assert.equal(bundle.service, "codex-swarm-monitor");
    assert.equal(bundle.privacy.localOnly, true);
    assert.equal(bundle.privacy.syntheticEvents, false);
    assert.equal(bundle.workspace.root, workspace);
    assert.equal(bundle.doctor.workspace, workspace);
    assert.equal(bundle.release.tag, "v0.1.0");
    assert.ok(bundle.release.plan.some((item) => item.id === "verify-source"));
    assert.equal(bundle.state.metrics.totalEvents, 1);
    assert.equal(bundle.state.events[0].payload.api_key, "[redacted]");
    assert.doesNotMatch(JSON.stringify(bundle), /sk-proj-secret1234567890|mockAgents|seedEvents|api\.dicebear/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("folder picker command maps supported operating systems", () => {
  assert.equal(folderPickerCommand("darwin").command, "osascript");
  assert.equal(folderPickerCommand("win32").command, "powershell");
  assert.equal(folderPickerCommand("linux", (command) => command === "zenity").command, "zenity");
  assert.equal(folderPickerCommand("linux", (command) => command === "kdialog").command, "kdialog");
  assert.equal(folderPickerCommand("linux", () => false), null);
});

test("server renders local SVG avatars without external providers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-avatar-"));
  const store = openStore(join(dir, "events.sqlite"));
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/avatar?name=Athena&role=Planner&backgroundColor=d1d4f9`);
    const svg = await response.text();
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.match(svg, /^<svg /);
    assert.match(svg, /aria-label="Athena avatar"/);
    assert.match(svg, /<title>Athena Planner<\/title>/);
    assert.match(svg, /data-avatar-style="notion-local-portrait"/);
    assert.match(svg, /data-avatar-version="7"/);
    assert.match(svg, /viewBox="0 0 96 96"/);
    assert.match(svg, /stroke-linecap="round"/);
    assert.match(svg, /#202124|#24292f|#1f2328/);
    assert.doesNotMatch(svg, /<text/i);
    assert.doesNotMatch(svg, /dicebear|api\.dicebear/i);
    assert.doesNotMatch(svg, /seed/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server exposes workspace doctor checks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-doctor-"));
  const store = openStore(join(dir, "events.sqlite"));
  const server = createSwarmServer({ store, defaultWorkspace: dir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const doctor = await (await fetch(`http://127.0.0.1:${port}/doctor?path=${encodeURIComponent(dir)}`)).json();
    assert.equal(doctor.workspace, dir);
    const runtime = doctor.checks.find((item) => item.id === "runtime");
    assert.equal(runtime.ok, true);
    assert.match(runtime.summary, /runtime/);
    assert.doesNotMatch(runtime.remediation || "", /^Install Node/);
    assert.ok(doctor.checks.some((item) => item.id === "workspace-readable" && item.ok));
    assert.ok(doctor.checks.some((item) => item.id === "hook-installed" && item.optional));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workspace doctor runs against the selected workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-doctor-cwd-"));
  const store = openStore(join(dir, "events.sqlite"));
  const selected = join(dir, "selected");
  const server = createSwarmServer({ store, defaultWorkspace: process.cwd() });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(selected, { recursive: true }));
    const doctor = await (await fetch(`http://127.0.0.1:${port}/doctor?path=${encodeURIComponent(selected)}`)).json();
    assert.equal(doctor.workspace, selected);

    const codex = doctor.checks.find((item) => item.id === "codex");
    if (codex?.ok) {
      const failingIds = doctor.readiness.doctor.failing?.map((item) => item.id) || [];
      assert.ok(!failingIds.includes("config.load"));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workspace doctor reflects hook installation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-doctor-hook-"));
  const store = openStore(join(dir, "events.sqlite"));
  const server = createSwarmServer({ store, defaultWorkspace: dir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    await fetch(`${base}/workspace/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: dir, eventBusUrl: base })
    });
    const doctor = await (await fetch(`${base}/doctor?path=${encodeURIComponent(dir)}`)).json();
    const hook = doctor.checks.find((item) => item.id === "hook-installed");
    assert.equal(hook.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installed Codex hook posts events into the live server", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-hook-e2e-"));
  const store = openStore(join(dir, "events.sqlite"));
  const target = join(dir, "target");
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(target, { recursive: true }));
    await (
      await fetch(`${base}/workspace/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target, eventBusUrl: base })
      })
    ).json();

    const hooks = JSON.parse(await readFile(join(target, ".codex/hooks.json"), "utf8"));
    const command = hooks.hooks.PostToolUse[0].hooks.find((hook) => hook.command.includes("codex-swarm-monitor")).command;
    assert.equal(typeof command, "string");
    const payload = {
      hook_event_name: "PostToolUse",
      tool_name: "shell",
      tool_input: { command: "sed -n '1,20p' AGENTS.md" },
      cwd: target
    };

    await runCommand(command, target, JSON.stringify(payload));

    const state = await (await fetch(`${base}/state`)).json();
    assert.equal(state.metrics.totalEvents, 1);
    assert.equal(state.files[0].path, "AGENTS.md");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SSE stream receives state after a posted event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-sse-"));
  const store = openStore(join(dir, "events.sqlite"));
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const abort = new AbortController();

  try {
    const streamPromise = readSseUntil(`${base}/stream`, (message) => message.state?.metrics?.totalEvents === 1, abort.signal);
    await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "file_read", agent_id: "main", path: "RALPH.md" })
    });
    const message = await streamPromise;
    assert.equal(message.sseId, 1);
    assert.equal(message.state.files[0].path, "RALPH.md");
  } finally {
    abort.abort();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SSE stream replays missed events after Last-Event-ID", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-sse-replay-"));
  const store = openStore(join(dir, "events.sqlite"));
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const workspace = join(dir, "workspace");
  const abort = new AbortController();

  try {
    const first = await (
      await fetch(`${base}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "file_read", agent_id: "main", path: "one.md", cwd: workspace })
      })
    ).json();
    await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "file_read", agent_id: "other", path: "noise.md", cwd: join(dir, "other") })
    });
    const second = await (
      await fetch(`${base}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "file_read", agent_id: "main", path: "two.md", cwd: workspace })
      })
    ).json();

    const message = await readSseUntil(
      `${base}/stream?path=${encodeURIComponent(workspace)}`,
      (item) => item.replay === true && item.event?.id === second.event.id,
      abort.signal,
      { "last-event-id": String(first.event.id) }
    );

    assert.equal(message.sseId, second.event.id);
    assert.equal(message.event.payload.path, "two.md");
    assert.equal(message.state.metrics.totalEvents, 2);
  } finally {
    abort.abort();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SSE stream emits heartbeat messages without storing events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-sse-heartbeat-"));
  const store = openStore(join(dir, "events.sqlite"));
  const server = createSwarmServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const abort = new AbortController();

  try {
    const originalSetInterval = globalThis.setInterval;
    globalThis.setInterval = (callback) => {
      queueMicrotask(callback);
      return 0;
    };
    try {
      const message = await readSseUntil(`${base}/stream`, (item) => item.type === "heartbeat", abort.signal);
      assert.equal(typeof message.timestamp, "number");
    } finally {
      globalThis.setInterval = originalSetInterval;
    }
    const state = await (await fetch(`${base}/state`)).json();
    assert.equal(state.metrics.totalEvents, 0);
    assert.equal(state.metrics.storedEvents, 0);
  } finally {
    abort.abort();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

function runCommand(command, cwd, input) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("sh", ["-c", command], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`Command exited ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function readSseUntil(url, predicate, signal, headers = {}) {
  const response = await fetch(url, { signal, headers });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeout = AbortSignal.timeout(3000);
  timeout.addEventListener("abort", () => reader.cancel().catch(() => {}));

  while (!timeout.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const idLine = part.split("\n").find((item) => item.startsWith("id: "));
      const line = part.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const message = JSON.parse(line.slice(6));
      if (idLine) message.sseId = Number(idLine.slice(4));
      if (predicate(message)) return message;
    }
  }
  throw new Error("Timed out waiting for SSE message");
}
