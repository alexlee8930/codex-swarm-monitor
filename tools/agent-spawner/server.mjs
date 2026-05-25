#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawnSubagent } from "./spawn.mjs";

const server = new McpServer({
  name: "codex-swarm-agent-spawner",
  version: "0.1.0"
});

server.tool(
  "spawn_subagent",
  "Spawn a Codex subagent with an isolated role prompt and emit lifecycle events to the Swarm Monitor.",
  {
    role: z.string().min(1).describe("Role prompt to use, e.g. explorer, planner, executor, reviewer, tester."),
    task: z.string().min(1).describe("Bounded task for the subagent."),
    maxTokens: z.number().int().positive().default(50000).describe("Approximate context budget for the child Codex run."),
    dryRun: z.boolean().default(false).describe("Emit spawn/complete events without launching Codex.")
  },
  async ({ role, task, maxTokens, dryRun }) => {
    const result = await spawnSubagent({ role, task, maxTokens, dryRun });
    return {
      content: [{ type: "text", text: result }]
    };
  }
);

await server.connect(new StdioServerTransport());
