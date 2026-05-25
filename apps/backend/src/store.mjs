import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = join(homedir(), ".codex-swarm-monitor", "swarm-monitor.sqlite");
const DEFAULT_MAX_EVENTS = 50000;
const AVATAR_VERSION = 7;
const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|passwd|secret|private[_-]?key|session[_-]?token|cookie)/i;
const SECRET_VALUE_PATTERNS = [
  /\b(sk-(?:proj-)?[A-Za-z0-9_-]{12,})\b/g,
  /\b(sk-ant-[A-Za-z0-9_-]{12,})\b/g,
  /\b(ghp_[A-Za-z0-9_]{20,})\b/g,
  /\b(github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{16,})\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b((?:OPENAI|ANTHROPIC|GOOGLE|GITHUB|SLACK|CODEX)[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)=)([^\s'"&]+)/gi
];

export function openStore(input = process.env.CODEX_SWARM_DB || DEFAULT_DB_PATH) {
  const options = typeof input === "string" ? { dbPath: input } : input;
  const dbPath = options.dbPath || process.env.CODEX_SWARM_DB || DEFAULT_DB_PATH;
  let maxEvents = normalizeMaxEvents(options.maxEvents ?? process.env.CODEX_SWARM_MAX_EVENTS ?? DEFAULT_MAX_EVENTS);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
  `);

  return {
    db,
    append(rawEvent) {
      const event = normalizeEvent(rawEvent);
      const statement = db.prepare(`
        INSERT INTO events (type, agent_id, timestamp, payload)
        VALUES (?, ?, ?, ?)
      `);
      const result = statement.run(
        event.type,
        event.agent_id,
        event.timestamp,
        JSON.stringify(event.payload)
      );
      if (maxEvents > 0) pruneEvents(db, maxEvents);
      return { ...event, id: Number(result.lastInsertRowid) };
    },
    list(limit = 500, filter = {}) {
      if (filter.workspace) {
        return allEvents(db)
          .filter((event) => matchesWorkspace(event, filter.workspace))
          .slice(-limit);
      }
      const rows = db
        .prepare(
          `SELECT id, type, agent_id, timestamp, payload
           FROM events
           ORDER BY id DESC
           LIMIT ?`
        )
        .all(limit);
      return rows
        .reverse()
        .map(parseEventRow);
    },
    after(id = 0, limit = 500, filter = {}) {
      const since = Number(id) || 0;
      const cappedLimit = Math.max(1, Math.floor(Number(limit) || 500));
      if (filter.workspace) {
        return allEvents(db)
          .filter((event) => event.id > since && matchesWorkspace(event, filter.workspace))
          .slice(0, cappedLimit);
      }
      const rows = db
        .prepare(
          `SELECT id, type, agent_id, timestamp, payload
           FROM events
           WHERE id > ?
           ORDER BY id ASC
           LIMIT ?`
        )
        .all(since, cappedLimit);
      return rows.map(parseEventRow);
    },
    latestId(filter = {}) {
      if (filter.workspace) {
        return allEvents(db)
          .filter((event) => matchesWorkspace(event, filter.workspace))
          .at(-1)?.id || 0;
      }
      return Number(db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM events").get().id);
    },
    clear(filter = {}) {
      if (!filter.workspace) {
        db.exec("DELETE FROM events");
        return;
      }
      const ids = matchingEventIds(db, filter.workspace);
      const statement = db.prepare("DELETE FROM events WHERE id = ?");
      for (const id of ids) statement.run(id);
    },
    count() {
      return Number(db.prepare("SELECT COUNT(*) AS count FROM events").get().count);
    },
    countFor(filter = {}) {
      if (!filter.workspace) return this.count();
      return allEvents(db).filter((event) => matchesWorkspace(event, filter.workspace)).length;
    },
    retention() {
      return {
        maxEvents,
        policy: maxEvents > 0 ? `keep latest ${maxEvents} events` : "unlimited"
      };
    },
    setRetention(value) {
      maxEvents = normalizeMaxEvents(value);
      if (maxEvents > 0) pruneEvents(db, maxEvents);
      return this.retention();
    },
    state(filter = {}) {
      const state = deriveState(this.list(1000, filter));
      state.metrics.storedEvents = this.countFor(filter);
      state.metrics.retentionMaxEvents = maxEvents;
      state.retention = this.retention();
      return state;
    },
    close() {
      db.close();
    }
  };
}

function matchesWorkspace(event, workspace) {
  if (!workspace) return true;
  const root = normalizePath(workspace);
  const cwd = normalizePath(event.payload?.cwd || event.payload?.workspace || event.payload?.workspace_root || event.payload?.project_root);
  if (!cwd) return false;
  return cwd === root || cwd.startsWith(`${root}/`);
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizeMaxEvents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return DEFAULT_MAX_EVENTS;
  return Math.floor(number);
}

function pruneEvents(db, maxEvents) {
  db.prepare(`
    DELETE FROM events
    WHERE id NOT IN (
      SELECT id FROM events ORDER BY id DESC LIMIT ?
    )
  `).run(maxEvents);
}

function matchingEventIds(db, workspace) {
  return allEvents(db)
    .filter((event) => matchesWorkspace(event, workspace))
    .map((event) => event.id);
}

function allEvents(db) {
  return db
    .prepare("SELECT id, type, agent_id, timestamp, payload FROM events ORDER BY id ASC")
    .all()
    .map(parseEventRow);
}

function parseEventRow(row) {
  return { ...row, payload: JSON.parse(row.payload) };
}

export function normalizeEvent(rawEvent = {}) {
  const type = String(rawEvent.type || rawEvent.hook_event_name || "event")
    .replace(/[^\w:-]+/g, "_")
    .toLowerCase();
  const agent_id = String(
    rawEvent.agent_id ||
      rawEvent.agentId ||
      rawEvent.agent ||
      process.env.OMX_AGENT_ID ||
      process.env.CODEX_AGENT_ID ||
      "main"
  );
  const timestamp = Number(rawEvent.timestamp || Date.now());
  const payload = { ...rawEvent };
  delete payload.type;
  delete payload.agent_id;
  delete payload.agentId;
  delete payload.timestamp;

  return { type, agent_id, timestamp, payload: redactSecrets(payload) };
}

export function redactSecrets(value, key = "") {
  if (value == null) return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
  if (typeof value === "string") return redactSecretString(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSecrets(entryValue, entryKey)]));
}

function redactSecretString(value) {
  return SECRET_VALUE_PATTERNS.reduce((output, pattern) => {
    if (pattern.source.includes("Bearer")) {
      return output.replace(pattern, `$1${REDACTED}`);
    }
    if (pattern.source.includes("API_KEY|TOKEN|SECRET|PASSWORD")) {
      return output.replace(pattern, `$1${REDACTED}`);
    }
    return output.replace(pattern, REDACTED);
  }, value);
}

export function deriveState(events) {
  const agents = new Map();
  const files = new Map();
  const edges = new Map();
  const now = Date.now();
  const metrics = {
    totalEvents: events.length,
    activeAgents: 0,
    mdFiles: 0,
    tokenEstimate: 0,
    costEstimate: 0,
    toolCalls: 0,
    runningSeconds: 0
  };

  for (const event of events) {
    const agent = ensureAgent(agents, event.agent_id);
    agent.lastSeen = event.timestamp;
    agent.eventCount += 1;

    const payload = event.payload || {};
    const toolName = payload.tool || payload.tool_name || payload.name;
    const path = payload.path || payload.file || payload.file_path;
    const task =
      payload.task ||
      payload.prompt ||
      payload.summary ||
      payload.command ||
      payload.description ||
      payload?.tool_input?.command;

    if (payload.role) agent.role = normalizeRole(payload.role);
    if (payload.parent) {
      agent.parent = String(payload.parent);
      edges.set(`${payload.parent}->${agent.id}`, {
        id: `${payload.parent}->${agent.id}`,
        source: String(payload.parent),
        target: agent.id
      });
    }
    if (task) agent.task = truncate(String(task), 180);
    if (toolName) {
      agent.tool = String(toolName);
      agent.toolCount += 1;
      metrics.toolCalls += 1;
    }

    if (event.type.includes("spawn")) {
      agent.status = "active";
      agent.task = truncate(String(payload.task || "Spawned subagent"), 180);
    } else if (event.type.includes("error") || Number(payload.exit_code || 0) > 0) {
      agent.status = "blocked";
    } else if (event.type.includes("complete") || event.type === "stop") {
      agent.status = "done";
    } else if (event.type.includes("pre_tool") || event.type.includes("post_tool")) {
      agent.status = "working";
      agent.task = toolName ? describeTool(toolName, payload) : agent.task;
    } else if (event.type.includes("session")) {
      agent.status = "online";
    }

    const mdPaths = collectMarkdownPaths(payload, path);
    for (const mdPath of mdPaths) {
      agent.mdFiles.add(mdPath);
      agent.currentFile = mdPath;
      agent.fileAction = inferFileAction(toolName, payload);
      if (!files.has(mdPath)) {
        files.set(mdPath, { path: mdPath, readers: new Set(), lastSeen: event.timestamp });
      }
      const file = files.get(mdPath);
      file.readers.add(agent.id);
      file.lastSeen = Math.max(file.lastSeen, event.timestamp);
    }

    const tokens = Number(payload.tokens || payload.token_count || payload.total_tokens || 0);
    metrics.tokenEstimate += tokens;
    metrics.costEstimate += Number(payload.cost || payload.cost_usd || 0);
    agent.tokens += tokens;
  }

  const agentList = [...agents.values()]
    .map((agent) => ({
      ...agent,
      status: staleStatus(agent, now),
      mdFiles: [...agent.mdFiles].sort(),
      avatar: avatarUrl(agent.id, agent.role)
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen);

  metrics.activeAgents = agentList.filter((agent) => agent.status !== "done").length;
  metrics.mdFiles = files.size;
  metrics.runningSeconds = events.length
    ? Math.max(0, Math.round((now - events[0].timestamp) / 1000))
    : 0;

  return {
    metrics,
    agents: agentList,
    files: [...files.values()].map((file) => ({
      ...file,
      readers: [...file.readers].sort()
    })),
    edges: [...edges.values()],
    events
  };
}

function ensureAgent(agents, id) {
  if (!agents.has(id)) {
    agents.set(id, {
      id,
      role: inferRole(id),
      status: "observing",
      task: "Waiting for activity",
      tool: "idle",
      toolCount: 0,
      tokens: 0,
      currentFile: "",
      fileAction: "",
      mdFiles: new Set(),
      eventCount: 0,
      lastSeen: 0,
      parent: null
    });
  }
  return agents.get(id);
}

function collectMarkdownPaths(payload, path) {
  const values = [
    path,
    payload?.tool_input?.path,
    payload?.tool_input?.file_path,
    payload?.tool_input?.cwd,
    payload?.tool_input?.command,
    payload?.command,
    payload?.prompt,
    payload?.raw?.raw_input
  ];
  if (Array.isArray(payload?.paths)) values.push(...payload.paths);
  return [...new Set(values
    .filter(Boolean)
    .map(String)
    .flatMap((value) => value.match(/(?:\.?[\w./-]+)?[\w.-]+\.md/g) || [])
    .map((value) => value.replace(/^["']|["']$/g, ""))
    .filter((value) => value.toLowerCase().endsWith(".md")))];
}

function inferRole(agentId) {
  const prefix = String(agentId).split(/[-_:]/)[0];
  const roles = {
    sisyphus: "Orchestrator",
    athena: "Planner",
    hermes: "Explorer",
    hephaestus: "Builder",
    argus: "Reviewer",
    themis: "Tester",
    main: "Leader"
  };
  return roles[prefix.toLowerCase()] || titleCase(prefix || "agent");
}

function normalizeRole(role) {
  const value = String(role || "Agent").toLowerCase();
  const roles = {
    orchestrator: "Orchestrator",
    planner: "Planner",
    explorer: "Explorer",
    builder: "Builder",
    reviewer: "Reviewer",
    tester: "Tester",
    executor: "Builder",
    analyst: "Planner",
    verifier: "Tester",
    main: "Leader"
  };
  return roles[value] || titleCase(value);
}

function describeTool(toolName, payload) {
  const action = inferFileAction(toolName, payload);
  const file = collectMarkdownPaths(payload, payload.path)[0];
  if (file) return `${action} ${file}`;
  const command = payload?.tool_input?.command || payload.command;
  if (command) return truncate(String(command), 120);
  return `Using ${toolName}`;
}

function inferFileAction(toolName, payload) {
  const tool = String(toolName || "").toLowerCase();
  const command = String(payload?.tool_input?.command || payload.command || "").toLowerCase();
  if (tool.includes("edit") || command.includes("apply_patch") || command.includes("cat >")) return "editing";
  if (tool.includes("write")) return "writing";
  if (tool.includes("grep") || tool.includes("search") || command.includes("rg ") || command.includes("grep ")) {
    return "grep";
  }
  if (tool.includes("read") || command.includes("sed ") || command.includes("cat ")) return "reading";
  return tool || "working";
}

function staleStatus(agent, now) {
  if (["done", "blocked"].includes(agent.status)) return agent.status;
  if (!agent.lastSeen) return agent.status;
  return now - agent.lastSeen > 5 * 60 * 1000 ? "idle" : agent.status;
}

function avatarUrl(agentId, role) {
  const bg = avatarBackground(role);
  return `/avatar?name=${encodeURIComponent(displayAvatarName(agentId))}&role=${encodeURIComponent(role || "Agent")}&backgroundColor=${bg}&v=${AVATAR_VERSION}`;
}

function avatarBackground(role) {
  const roleBg = {
    Orchestrator: "#b6e3f4",
    Planner: "#d1d4f9",
    Explorer: "#ffd5dc",
    Builder: "#c0aede",
    Reviewer: "#ffdfbf",
    Tester: "#c0e8d5",
    Leader: "#b6e3f4"
  };
  return (roleBg[role] || "#d1d4f9").replace("#", "");
}

function displayAvatarName(agentId) {
  const value = String(agentId || "Agent").split("-")[0];
  return titleCase(value);
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
