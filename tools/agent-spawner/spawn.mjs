import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const EVENT_BUS_URL = process.env.EVENT_BUS_URL || process.env.CODEX_SWARM_EVENT_BUS || "http://127.0.0.1:4000";

export async function spawnSubagent({
  role,
  task,
  maxTokens = 50000,
  cwd = process.cwd(),
  dryRun = false
}) {
  const safeRole = sanitizeRole(role);
  const agentId = `${safeRole}-${crypto.randomUUID().slice(0, 6)}`;
  const parent = process.env.OMX_AGENT_ID || process.env.CODEX_AGENT_ID || "main";

  await postEvent({
    type: "agent_spawn",
    agent_id: agentId,
    role: safeRole,
    task,
    parent,
    cwd,
    workspace_root: cwd
  });

  const prompt = buildPrompt({ role: safeRole, task, agentId, cwd });
  if (dryRun || process.env.CODEX_SWARM_DRY_RUN === "1") {
    const text = `[dry-run] ${agentId} would run Codex for role=${safeRole}: ${task}`;
    await postEvent({
      type: "agent_complete",
      agent_id: agentId,
      role: safeRole,
      parent,
      result_length: text.length,
      cwd,
      workspace_root: cwd
    });
    return text;
  }

  const result = await runCodex({ prompt, maxTokens, cwd, agentId });
  await postEvent({
    type: "agent_complete",
    agent_id: agentId,
    role: safeRole,
    parent,
    result_length: result.stdout.length,
    exit_code: result.code,
    cwd,
    workspace_root: cwd
  });

  if (result.code !== 0) {
    throw new Error(`Subagent ${agentId} exited ${result.code}: ${result.stderr.slice(0, 1200)}`);
  }
  return result.stdout;
}

function buildPrompt({ role, task, agentId, cwd }) {
  const rolePromptPath = resolve(cwd, ".codex/prompts", `${role}.md`);
  const rolePrompt = existsSync(rolePromptPath)
    ? readFileSync(rolePromptPath, "utf8")
    : `You are a ${role} Codex subagent. Work narrowly and return concise evidence.`;
  return `${rolePrompt}

## Swarm Assignment
Agent ID: ${agentId}
Role: ${role}
Task: ${task}

Report only useful findings, files changed, and verification evidence.`;
}

function runCodex({ prompt, maxTokens, cwd, agentId }) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "codex",
      [
        "exec",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        cwd,
        "-c",
        `model_context_window=${Number(maxTokens)}`,
        "-"
      ],
      {
        cwd,
        env: {
          ...process.env,
          OMX_AGENT_ID: agentId,
          CODEX_SWARM_EVENT_BUS: EVENT_BUS_URL
        },
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(prompt);
  });
}

async function postEvent(event) {
  try {
    await fetch(`${EVENT_BUS_URL.replace(/\/$/, "")}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: Date.now(), ...event }),
      signal: AbortSignal.timeout(1000)
    });
  } catch {
    // The spawner remains usable even when the monitor is offline.
  }
}

function sanitizeRole(role) {
  return String(role || "executor")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "executor";
}
