#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = mkdtempSync(join(tmpdir(), "codex-swarm-spawner-"));
const received = [];
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/events") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  received.push(JSON.parse(body));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
process.env.EVENT_BUS_URL = `http://127.0.0.1:${port}`;
const { spawnSubagent } = await import("./spawn.mjs");

try {
  const result = await spawnSubagent({
    role: "explorer",
    task: "Verify that the agent-spawner can emit lifecycle events.",
    cwd: workspace,
    dryRun: true
  });

  assert.match(result, /dry-run/);
  assert.match(result, /explorer/);
  assert.equal(received.length, 2);
  assert.equal(received[0].type, "agent_spawn");
  assert.equal(received[1].type, "agent_complete");
  assert.equal(received[0].cwd, workspace);
  assert.equal(received[0].workspace_root, workspace);
  assert.equal(received[1].cwd, workspace);
  assert.equal(received[1].workspace_root, workspace);
  assert.equal(received[1].parent, "main");
  console.log("agent-spawner dry-run ok");
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(workspace, { recursive: true, force: true });
}
