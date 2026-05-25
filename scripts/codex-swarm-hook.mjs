#!/usr/bin/env node

const eventBusUrl =
  process.env.CODEX_SWARM_EVENT_BUS || process.env.EVENT_BUS_URL || "http://127.0.0.1:4000";

const input = await readStdin();
const payload = safeJson(input);
const hookName = process.argv[2] || payload.hook_event_name || payload.event || "codex_hook";
const event = toSwarmEvent(hookName, payload);

try {
  await fetch(`${eventBusUrl.replace(/\/$/, "")}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(2500)
  });
} catch {
  // Hooks must never break Codex execution when the monitor is not running.
}

function toSwarmEvent(hookName, payload) {
  const toolInput = payload.tool_input || payload.input || {};
  const command = toolInput.command || payload.command || "";
  const prompt = payload.prompt || payload.user_prompt || toolInput.prompt || "";
  const tool = payload.tool_name || payload.tool || payload.name || inferToolName(command);
  const path = toolInput.path || toolInput.file_path || payload.path || inferPath(command);
  return {
    type: hookName,
    agent_id: process.env.OMX_AGENT_ID || process.env.CODEX_AGENT_ID || "main",
    timestamp: Date.now(),
    hook_event_name: payload.hook_event_name || hookName,
    session_id: payload.session_id,
    tool,
    tool_input: toolInput,
    path,
    cwd: payload.cwd || process.cwd(),
    command,
    prompt,
    summary: summarizeHook(hookName, tool, path, command, prompt),
    raw: compactPayload(payload)
  };
}

function inferToolName(command) {
  const value = String(command || "");
  if (!value) return undefined;
  if (/\brg\b|\bgrep\b/.test(value)) return "grep";
  if (/\bapply_patch\b/.test(value)) return "edit";
  if (/\bsed\b|\bcat\b|\bnl\b/.test(value)) return "read";
  return "shell";
}

function inferPath(command) {
  const match = String(command || "").match(/(?:\.?[\w./-]+)?[\w.-]+\.md\b/);
  return match ? match[0] : undefined;
}

function summarizeHook(hookName, tool, path, command, prompt) {
  if (path) return `${tool || hookName} ${path}`;
  if (command) return String(command).slice(0, 180);
  if (prompt) return String(prompt).slice(0, 180);
  return hookName;
}

function compactPayload(payload) {
  const json = JSON.stringify(payload);
  return json.length > 4000 ? { truncated: true, preview: json.slice(0, 4000) } : payload;
}

function safeJson(input) {
  try {
    return input.trim() ? JSON.parse(input) : {};
  } catch {
    return { raw_input: input };
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
