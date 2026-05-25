import { existsSync, statSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const EMBED_DIR = "codex-swarm-monitor";
const EMBED_HOOK = "hook.mjs";

export const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "PreCompact",
  "PostCompact",
  "Stop"
];

export async function analyzeWorkspace(inputPath = process.cwd()) {
  const root = resolve(String(inputPath || process.cwd()).replace(/^~(?=$|\/)/, process.env.HOME || ""));
  assertDirectory(root);

  const files = await scanFiles(root);
  const mdFiles = files.filter((file) => file.endsWith(".md"));
  const codexFiles = files.filter((file) => file.startsWith(".codex/"));
  const omxFiles = files.filter((file) => file.startsWith(".omx/"));
  const sqliteFiles = files.filter((file) => file.endsWith(".sqlite"));

  const configPath = join(root, ".codex/config.toml");
  const hooksPath = join(root, ".codex/hooks.json");
  const embeddedHookPath = join(root, ".codex", EMBED_DIR, EMBED_HOOK);
  const agentsPath = join(root, "AGENTS.md");
  const ralphPath = join(root, "RALPH.md");
  const embeddedEventBusUrl = await readEmbeddedEventBusUrl(embeddedHookPath);

  return {
    root,
    name: root.split("/").filter(Boolean).at(-1) || root,
    repository: await summarizeRepository(root, files),
    detected: {
      codex: existsSync(join(root, ".codex")),
      hooks: existsSync(hooksPath),
      mcp: existsSync(configPath) && (await safeRead(configPath)).includes("[mcp_servers"),
      omx: existsSync(join(root, ".omx")),
      agents: existsSync(agentsPath),
      ralph: existsSync(ralphPath)
    },
    counts: {
      markdown: mdFiles.length,
      codex: codexFiles.length,
      omx: omxFiles.length,
      sqlite: sqliteFiles.length
    },
    hierarchy: buildHierarchy({ mdFiles, codexFiles, omxFiles, sqliteFiles }),
    harness: await buildHarness(root, { files, codexFiles, omxFiles, sqliteFiles, hooksPath, configPath }),
    markdown: await summarizeMarkdown(root, mdFiles),
    databases: inspectSqlite(root, sqliteFiles),
    instructions: {
      agents: await summarizeDocument(agentsPath),
      ralph: await summarizeDocument(ralphPath)
    },
    install: {
      configured: await hasSwarmHook(hooksPath),
      hooksPath,
      configPath
    },
    trust: {
      hooksPath,
      hookPath: embeddedHookPath,
      eventBusUrl: embeddedEventBusUrl,
      expectedCommand: `"${process.execPath}" "${embeddedHookPath}" <hook-event>`,
      firstRunNotice: "Codex may ask you to trust this workspace hook on first run. Confirm that the hook path is inside .codex/codex-swarm-monitor before approving."
    }
  };
}

async function summarizeRepository(root, files) {
  const gitPath = join(root, ".git");
  const hasGit = existsSync(gitPath);
  if (!hasGit) {
    return {
      hasGit: false,
      branch: "not a git repository",
      remote: "not configured",
      worktreeFiles: files.length
    };
  }

  const gitDir = await resolveGitDir(root, gitPath);
  const head = await safeRead(join(gitDir, "HEAD"));
  const config = await safeRead(join(gitDir, "config"));
  return {
    hasGit: true,
    branch: branchName(head),
    remote: remoteLabel(config),
    worktreeFiles: files.length
  };
}

async function resolveGitDir(root, gitPath) {
  if (statSync(gitPath).isDirectory()) return gitPath;
  const pointer = await safeRead(gitPath);
  const match = pointer.match(/^gitdir:\s*(.+)$/m);
  if (!match) return gitPath;
  const value = match[1].trim();
  return resolve(root, value);
}

function branchName(head) {
  const match = String(head || "").match(/^ref:\s+refs\/heads\/(.+)$/m);
  if (match) return match[1];
  return head ? "detached HEAD" : "unknown";
}

function remoteLabel(config) {
  const match = String(config || "").match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/m);
  if (!match) return "not configured";
  const url = match[1].trim();
  if (url.startsWith("git@")) {
    return url.replace(/^git@/, "").replace(":", "/").replace(/\.git$/, "");
  }
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname.replace(/\.git$/, "")}`;
  } catch {
    return "origin configured";
  }
}

export async function installWorkspace(inputPath = process.cwd(), eventBusUrl = "http://127.0.0.1:4000", options = {}) {
  const root = resolve(String(inputPath || process.cwd()).replace(/^~(?=$|\/)/, process.env.HOME || ""));
  assertDirectory(root);

  const codexDir = join(root, ".codex");
  const runtimeDir = join(codexDir, EMBED_DIR);
  await mkdir(codexDir, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });

  const hookScript = join(PACKAGE_ROOT, "scripts/codex-swarm-hook.mjs");
  const embeddedHook = join(runtimeDir, EMBED_HOOK);
  const mcpScript = join(PACKAGE_ROOT, "tools/agent-spawner/server.mjs");
  const hooksPath = join(codexDir, "hooks.json");
  const configPath = join(codexDir, "config.toml");

  await writeEmbeddedHook(embeddedHook, hookScript, eventBusUrl);
  await writeHooks(hooksPath, embeddedHook);
  if (options.includeMcp === true) {
    await appendConfig(configPath, mcpScript, eventBusUrl);
  }

  return analyzeWorkspace(root);
}

export async function uninstallWorkspace(inputPath = process.cwd()) {
  const root = resolve(String(inputPath || process.cwd()).replace(/^~(?=$|\/)/, process.env.HOME || ""));
  assertDirectory(root);

  const codexDir = join(root, ".codex");
  const runtimeDir = join(codexDir, EMBED_DIR);
  const hooksPath = join(codexDir, "hooks.json");
  const configPath = join(codexDir, "config.toml");

  await removeHooks(hooksPath);
  await removeConfigBlock(configPath);
  await rm(runtimeDir, { recursive: true, force: true });

  return analyzeWorkspace(root);
}

async function writeEmbeddedHook(embeddedHook, hookScript, eventBusUrl) {
  const source = await readFile(hookScript, "utf8");
  const sourceWithoutShebang = source.replace(/^#!.*\r?\n/, "");
  await writeFile(
    embeddedHook,
    `#!/usr/bin/env node
process.env.CODEX_SWARM_EVENT_BUS ||= ${JSON.stringify(eventBusUrl)};
${sourceWithoutShebang}
`
  );
  await chmod(embeddedHook, 0o755);
}

async function readEmbeddedEventBusUrl(embeddedHook) {
  const source = await safeRead(embeddedHook);
  if (!source) return "";
  const match = source.match(/CODEX_SWARM_EVENT_BUS\s*\|\|=\s*("[^"\n]*(?:\\.[^"\n]*)*")/);
  if (!match) return "";
  try {
    return JSON.parse(match[1]);
  } catch {
    return "";
  }
}

async function writeHooks(hooksPath, embeddedHook) {
  let hooksJson = { hooks: {} };
  if (existsSync(hooksPath)) {
    try {
      hooksJson = JSON.parse(await readFile(hooksPath, "utf8"));
    } catch {
      hooksJson = { hooks: {} };
    }
  }
  hooksJson.hooks ||= {};

  for (const eventName of CODEX_HOOK_EVENTS) {
    const command = `"${process.execPath}" "${embeddedHook}" ${eventName}`;
    const entry = {
      type: "command",
      command,
      ...(eventName === "Stop" ? { timeout: 5 } : {})
    };
    const existing = hooksJson.hooks[eventName] || [];
    const group = existing[0] || { hooks: [] };
    group.hooks = (group.hooks || []).filter((hook) => !isSwarmHookCommand(hook.command));
    group.hooks.push(entry);
    hooksJson.hooks[eventName] = [group, ...existing.slice(1)];
  }

  await mkdir(dirname(hooksPath), { recursive: true });
  await writeFile(hooksPath, `${JSON.stringify(hooksJson, null, 2)}\n`);
}

async function removeHooks(hooksPath) {
  if (!existsSync(hooksPath)) return;
  let hooksJson;
  try {
    hooksJson = JSON.parse(await readFile(hooksPath, "utf8"));
  } catch {
    return;
  }
  hooksJson.hooks ||= {};

  for (const [eventName, groups] of Object.entries(hooksJson.hooks)) {
    if (!Array.isArray(groups)) continue;
    const keptGroups = groups
      .map((group) => ({
        ...group,
        hooks: (group.hooks || []).filter((hook) => !isSwarmHookCommand(hook.command))
      }))
      .filter((group) => (group.hooks || []).length > 0);
    if (keptGroups.length) hooksJson.hooks[eventName] = keptGroups;
    else delete hooksJson.hooks[eventName];
  }

  await writeFile(hooksPath, `${JSON.stringify(hooksJson, null, 2)}\n`);
}

function isSwarmHookCommand(command) {
  const value = String(command || "").replace(/\\/g, "/");
  return value.includes(`${EMBED_DIR}/${EMBED_HOOK}`) || value.includes("codex-swarm-hook.mjs");
}

async function appendConfig(configPath, mcpScript, eventBusUrl) {
  const marker = "# Codex Swarm Monitor MCP Server";
  const block = `
${marker}
[mcp_servers.agent_spawner]
command = "${process.execPath}"
args = ["${mcpScript}"]
enabled = true
startup_timeout_sec = 10
env = { EVENT_BUS_URL = "${eventBusUrl}" }
`;
  const current = existsSync(configPath) ? await readFile(configPath, "utf8") : "";
  if (current.includes(marker)) return;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${current.trimEnd()}\n\n${block.trimStart()}`);
}

async function removeConfigBlock(configPath) {
  if (!existsSync(configPath)) return;
  const marker = "# Codex Swarm Monitor MCP Server";
  const current = await readFile(configPath, "utf8");
  if (!current.includes(marker)) return;
  const next = current
    .replace(/\n?# Codex Swarm Monitor MCP Server\n\[mcp_servers\.agent_spawner\]\n(?:[^\n]*\n){0,6}?env = \{ EVENT_BUS_URL = "[^"]*" \}\n?/m, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  await writeFile(configPath, `${next}\n`);
}

async function hasSwarmHook(hooksPath) {
  if (!existsSync(hooksPath)) return false;
  const raw = await safeRead(hooksPath);
  try {
    const parsed = JSON.parse(raw);
    return CODEX_HOOK_EVENTS.every((eventName) =>
      hookGroups(parsed.hooks?.[eventName]).some((hook) => isSwarmHookCommand(hook.command))
    );
  } catch {
    return false;
  }
}

async function scanFiles(root) {
  const output = [];
  const ignored = new Set(["node_modules", ".git", "data", "dist", "build", ".next"]);
  async function walk(dir, depth) {
    if (depth > 5) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      const rel = relative(root, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        output.push(rel);
      }
    }
  }
  await walk(root, 0);
  return output.sort();
}

function buildHierarchy({ mdFiles, codexFiles, omxFiles, sqliteFiles }) {
  return [
    { id: "workspace", label: "Workspace", kind: "root", count: mdFiles.length + codexFiles.length + omxFiles.length },
    { id: "instructions", label: "Instructions", kind: "section", count: mdFiles.filter((file) => /(^|\/)(AGENTS|RALPH|README|prd)\.md$/i.test(file)).length },
    { id: "codex", label: "Codex harness", kind: "section", count: codexFiles.length },
    { id: "omx", label: "OMX / Ralph loop", kind: "section", count: omxFiles.length },
    { id: "sqlite", label: "Runtime databases", kind: "section", count: sqliteFiles.length }
  ];
}

async function buildHarness(root, { files, codexFiles, omxFiles, sqliteFiles, hooksPath, configPath }) {
  const hookConfig = await readHooksSummary(hooksPath);
  const config = await safeRead(configPath);
  const ralphLoop = await extractRalphLoop(root, files);
  const goalDbs = sqliteFiles.filter((file) => /(^|\/)(goals?|state)_\d*\.sqlite$/i.test(file) || /goals?\.sqlite$/i.test(file));
  const logDbs = sqliteFiles.filter((file) => /(^|\/)logs?_\d*\.sqlite$/i.test(file) || /logs?\.sqlite$/i.test(file));
  const codexAgentFiles = codexFiles.filter((file) => file.startsWith(".codex/agents/") && file.endsWith(".toml"));
  const promptFiles = codexFiles.filter((file) => file.startsWith(".codex/prompts/") && file.endsWith(".md"));
  const omxStateFiles = omxFiles.filter((file) => file.startsWith(".omx/state/"));
  return {
    summary: [
      {
        id: "agents",
        label: "Agent roster",
        value: codexAgentFiles.length,
        detail: samplePaths(codexAgentFiles)
      },
      {
        id: "prompts",
        label: "Prompt library",
        value: promptFiles.length,
        detail: samplePaths(promptFiles)
      },
      {
        id: "hooks",
        label: "Hook events",
        value: hookConfig.events.length,
        detail: hookConfig.events.slice(0, 5)
      },
      {
        id: "mcp",
        label: "MCP servers",
        value: [...config.matchAll(/^\[mcp_servers[.\]]/gm)].length,
        detail: [...config.matchAll(/^\[mcp_servers\.([^\]]+)\]/gm)].map((match) => match[1]).slice(0, 5)
      },
      {
        id: "runtime",
        label: "Runtime DBs",
        value: sqliteFiles.length,
        detail: samplePaths([...goalDbs, ...logDbs, ...sqliteFiles])
      },
      {
        id: "ralph",
        label: "Ralph / OMX loop",
        value: ralphLoop.successCriteria.length + ralphLoop.tasks.length + ralphLoop.verificationCommands.length,
        detail: samplePaths([...ralphLoop.documents, ...omxStateFiles, ...omxFiles])
      }
    ],
    loops: inferLoopSignals(files, sqliteFiles, omxFiles),
    stages: inferLoopStages({ files, codexAgentFiles, promptFiles, sqliteFiles, omxFiles, hookConfig, config, ralphLoop }),
    ralph: ralphLoop,
    hooks: hookConfig
  };
}

async function extractRalphLoop(root, files) {
  const documents = files
    .filter((file) => /(^|\/)(RALPH|IMPLEMENTATION_PLAN|STEERING|prd)\.md$/i.test(file))
    .slice(0, 12);
  const parsed = await Promise.all(
    documents.map(async (file) => {
      const text = await safeRead(join(root, file));
      return {
        file,
        successCriteria: extractSuccessCriteria(file, text),
        tasks: extractPlanTasks(file, text),
        verificationCommands: extractVerificationCommands(file, text)
      };
    })
  );
  const successCriteria = ensureUniqueItemIds(parsed.flatMap((doc) => doc.successCriteria), "SC");
  const tasks = ensureUniqueItemIds(parsed.flatMap((doc) => doc.tasks), "T");
  const verificationCommands = ensureUniqueItemIds(parsed.flatMap((doc) => doc.verificationCommands), "V");
  return {
    documents,
    successCriteria: successCriteria.slice(0, 12),
    tasks: tasks.slice(0, 12),
    verificationCommands: verificationCommands.slice(0, 12)
  };
}

function ensureUniqueItemIds(items, fallbackPrefix) {
  const seen = new Map();
  return items.map((item, index) => {
    const baseId = cleanMarkdown(item.id) || `${fallbackPrefix}-${index + 1}`;
    const count = seen.get(baseId) || 0;
    seen.set(baseId, count + 1);
    return {
      ...item,
      id: count === 0 ? baseId : `${baseId}-${count + 1}`
    };
  });
}

function extractSuccessCriteria(file, text) {
  const criteria = [];
  for (const [index, line] of String(text || "").split(/\r?\n/).entries()) {
    const scMatch = line.match(/^\s*[-*]\s*(?:\[(SC-[^\]]+)\]|(SC-\d+))\s*(.+)$/i);
    const checkboxMatch = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(?:\[(SC-[^\]]+)\]\s*)?(.+)$/);
    if (scMatch) {
      criteria.push({
        id: scMatch[1] || scMatch[2],
        label: cleanMarkdown(scMatch[3]),
        state: inferChecklistState(line),
        source: file,
        line: index + 1
      });
    } else if (checkboxMatch && /success|criteria|verification|검증|통과|완료/i.test(checkboxMatch[3])) {
      criteria.push({
        id: checkboxMatch[2] || `SC-${criteria.length + 1}`,
        label: cleanMarkdown(checkboxMatch[3]),
        state: checkboxMatch[1].trim().toLowerCase() === "x" ? "done" : "open",
        source: file,
        line: index + 1
      });
    }
  }
  return criteria;
}

function extractPlanTasks(file, text) {
  const tasks = [];
  let section = "";
  for (const [index, line] of String(text || "").split(/\r?\n/).entries()) {
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      section = cleanMarkdown(heading[1]);
      continue;
    }
    const checkboxMatch = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.+)$/);
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    const taskMatch = line.match(/^\s*(?:[-*]\s*)?(Task\s*\d+|T\d+|Step\s*\d+)[\s:.-]+(.+)$/i);
    const numberedMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (checkboxMatch && !/success|criteria|verification|검증|통과/i.test(checkboxMatch[2])) {
      tasks.push({
        id: `T-${tasks.length + 1}`,
        label: cleanMarkdown(checkboxMatch[2]),
        state: checkboxMatch[1].trim().toLowerCase() === "x" ? "done" : "open",
        source: file,
        line: index + 1
      });
    } else if (bulletMatch && isTaskSection(section) && !looksLikeArchitectureNarrative(bulletMatch[1])) {
      tasks.push({
        id: `${sectionTaskPrefix(section)}-${tasks.length + 1}`,
        label: cleanMarkdown(bulletMatch[1]),
        state: inferChecklistState(line),
        source: file,
        line: index + 1
      });
    } else if (numberedMatch && isTaskSection(section) && !looksLikeArchitectureNarrative(numberedMatch[2])) {
      tasks.push({
        id: `${sectionTaskPrefix(section)}-${numberedMatch[1]}`,
        label: cleanMarkdown(numberedMatch[2]),
        state: inferChecklistState(line),
        source: file,
        line: index + 1
      });
    } else if (taskMatch) {
      tasks.push({
        id: cleanMarkdown(taskMatch[1]),
        label: cleanMarkdown(taskMatch[2]),
        state: inferChecklistState(line),
        source: file,
        line: index + 1
      });
    }
  }
  return tasks;
}

function isTaskSection(section) {
  if (/current implementation update|architecture|전체 그림|기술 스택|관찰성 전략|setup|셋업|mvp 범위 합의|첫 .*goal|프로젝트 부트스트랩|캐릭터 디자인|솔직한 어려움|확인 요청/i.test(section)) return false;
  return /task|plan|scope|mvp|must|should|nice|follow-up|follow up|next|todo|implementation|작업|범위|다음/i.test(section);
}

function sectionTaskPrefix(section) {
  if (/must/i.test(section)) return "MUST";
  if (/should/i.test(section)) return "SHOULD";
  if (/nice|follow/i.test(section)) return "NEXT";
  return "T";
}

function looksLikeArchitectureNarrative(value) {
  return /^(Codex CLI|Instrumentation Layer|Event Bus|Swarm UI)\b/i.test(cleanMarkdown(value));
}

function extractVerificationCommands(file, text) {
  const commands = [];
  const lines = String(text || "").split(/\r?\n/);
  let inVerificationSection = false;
  let inFence = false;
  for (const [index, line] of lines.entries()) {
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      inVerificationSection = /verification|검증|test command|checks/i.test(heading[1]);
      inFence = false;
      continue;
    }
    if (!inVerificationSection) continue;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && !/^\s*(npm|node|curl|codex|python|bun|pytest|pnpm|yarn)\b/.test(line)) continue;
    const command = line.trim();
    if (!command || command.startsWith("#")) continue;
    commands.push({
      id: `V-${commands.length + 1}`,
      command: cleanMarkdown(command),
      source: file,
      line: index + 1
    });
  }
  return commands;
}

function inferChecklistState(line) {
  return /\[[xX]\]/.test(line) || /\b(done|complete|완료|통과)\b/i.test(line) ? "done" : "open";
}

function cleanMarkdown(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s*\|\s*Verification:.+$/i, "")
    .trim();
}

async function readHooksSummary(hooksPath) {
  const raw = await safeRead(hooksPath);
  if (!raw) return { configured: false, events: [], swarmEvents: [], missingSwarmEvents: CODEX_HOOK_EVENTS, totalCommands: 0 };
  try {
    const parsed = JSON.parse(raw);
    const events = Object.entries(parsed.hooks || {}).filter(([, groups]) => hookGroups(groups).length > 0);
    const swarmEvents = CODEX_HOOK_EVENTS.filter((eventName) =>
      hookGroups(parsed.hooks?.[eventName]).some((hook) => isSwarmHookCommand(hook.command))
    );
    return {
      configured: swarmEvents.length === CODEX_HOOK_EVENTS.length,
      events: events.map(([event]) => event),
      swarmEvents,
      missingSwarmEvents: CODEX_HOOK_EVENTS.filter((eventName) => !swarmEvents.includes(eventName)),
      totalCommands: events.reduce((sum, [, groups]) => sum + hookGroups(groups).length, 0)
    };
  } catch {
    return { configured: false, events: [], swarmEvents: [], missingSwarmEvents: CODEX_HOOK_EVENTS, totalCommands: 0, error: "hooks.json is not valid JSON" };
  }
}

function hookGroups(groups) {
  return Array.isArray(groups) ? groups.flatMap((group) => Array.isArray(group.hooks) ? group.hooks : []) : [];
}

function inferLoopSignals(files, sqliteFiles, omxFiles) {
  return [
    { label: "Goal store", active: sqliteFiles.some((file) => /goals?_\d*\.sqlite|goals?\.sqlite/i.test(file)) },
    { label: "Runtime logs", active: sqliteFiles.some((file) => /logs?_\d*\.sqlite|logs?\.sqlite/i.test(file)) || omxFiles.some((file) => file.startsWith(".omx/logs/")) },
    { label: "State snapshots", active: sqliteFiles.some((file) => /state_\d*\.sqlite|state\.sqlite/i.test(file)) || omxFiles.some((file) => file.startsWith(".omx/state/")) },
    { label: "Instruction loop", active: files.some((file) => /(^|\/)(AGENTS|RALPH|STEERING|IMPLEMENTATION_PLAN)\.md$/i.test(file)) }
  ];
}

function inferLoopStages({ files, codexAgentFiles, promptFiles, sqliteFiles, omxFiles, hookConfig, config, ralphLoop }) {
  const instructionFiles = files.filter((file) => /(^|\/)(AGENTS|RALPH|STEERING|IMPLEMENTATION_PLAN|prd|README)\.md$/i.test(file));
  const mcpServers = [...config.matchAll(/^\[mcp_servers\.([^\]]+)\]/gm)].map((match) => `mcp:${match[1]}`);
  const runtimeEvidence = [
    ...sqliteFiles,
    ...omxFiles.filter((file) => file.startsWith(".omx/logs/") || file.startsWith(".omx/state/"))
  ];
  return [
    {
      id: "instructions",
      label: "Instructions",
      state: instructionFiles.length ? "active" : "missing",
      detail: "AGENTS, RALPH, PRD, steering docs",
      artifacts: samplePaths(instructionFiles)
    },
    {
      id: "agents-prompts",
      label: "Agents & prompts",
      state: codexAgentFiles.length || promptFiles.length ? "active" : "missing",
      detail: "Role files and prompt library",
      artifacts: samplePaths([...codexAgentFiles, ...promptFiles])
    },
    {
      id: "hooks-mcp",
      label: "Hooks & MCP",
      state: hookConfig.events.length || mcpServers.length ? "active" : "missing",
      detail: "Lifecycle events and optional spawners",
      artifacts: samplePaths([...hookConfig.events.map((event) => `hook:${event}`), ...mcpServers])
    },
    {
      id: "runtime-evidence",
      label: "Runtime evidence",
      state: runtimeEvidence.length ? "active" : "missing",
      detail: "SQLite, logs, state snapshots",
      artifacts: samplePaths(runtimeEvidence)
    },
    {
      id: "acceptance-loop",
      label: "Acceptance loop",
      state: ralphLoop.successCriteria.length || ralphLoop.tasks.length ? "active" : "missing",
      detail: "Success criteria and implementation tasks",
      artifacts: samplePaths([
        ...ralphLoop.successCriteria.map((item) => `${item.id}: ${item.label}`),
        ...ralphLoop.tasks.map((item) => `${item.id}: ${item.label}`),
        ...ralphLoop.verificationCommands.map((item) => item.command)
      ])
    }
  ];
}

function samplePaths(paths) {
  return [...new Set(paths)].slice(0, 4);
}

async function summarizeMarkdown(root, mdFiles) {
  const important = mdFiles
    .filter((file) => /(^|\/)(AGENTS|RALPH|README|prd|IMPLEMENTATION_PLAN|STEERING)\.md$/i.test(file))
    .slice(0, 30);
  return Promise.all(
    important.map(async (file) => {
      const text = await safeRead(join(root, file));
      return {
        path: file,
        lines: text ? text.split(/\r?\n/).length : 0,
        headings: [...text.matchAll(/^#{1,3}\s+(.+)$/gm)].slice(0, 8).map((match) => match[1])
      };
    })
  );
}

async function summarizeDocument(path) {
  const text = await safeRead(path);
  if (!text) return null;
  return {
    path,
    lines: text.split(/\r?\n/).length,
    headings: [...text.matchAll(/^#{1,3}\s+(.+)$/gm)].slice(0, 10).map((match) => match[1])
  };
}

function inspectSqlite(root, sqliteFiles) {
  return sqliteFiles.slice(0, 12).map((file) => {
    const fullPath = join(root, file);
    try {
      const db = new DatabaseSync(fullPath, { readOnly: true });
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((row) => row.name);
      const tableCounts = Object.fromEntries(
        tables.slice(0, 8).map((table) => {
          try {
            return [table, db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count];
          } catch {
            return [table, null];
          }
        })
      );
      db.close();
      return { path: file, tables, tableCounts };
    } catch (error) {
      return { path: file, error: error.message };
    }
  });
}

async function safeRead(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function assertDirectory(path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`Workspace folder not found: ${path}`);
  }
}
