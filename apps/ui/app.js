let state = {
  metrics: {},
  agents: [],
  files: [],
  edges: [],
  events: []
};

let workspace = null;
let currentPath = "";
let doctor = null;
let systemState = null;
let versionState = null;
let releaseState = null;
let streamState = {
  status: "connecting",
  lastMessageAt: null,
  reconnects: 0,
  lastEventId: 0,
  lastEventLatencyMs: null,
  replayedEvents: 0,
  lastReplayAt: null
};
let streamEvents = null;
const replayedEventIds = new Set();

const rankColors = {
  Orchestrator: "#1f883d",
  Planner: "#0969da",
  Explorer: "#0a7f72",
  Builder: "#8250df",
  Reviewer: "#cf222e",
  Tester: "#57606a",
  Leader: "#1f883d"
};

const $ = (selector) => document.querySelector(selector);

async function boot() {
  const [current, system, version] = await Promise.all([
    fetchJson("/workspace/current"),
    fetchJson("/system"),
    fetchJson("/version")
  ]);
  currentPath = current.path;
  versionState = version;
  renderSystem(system);
  $("#workspace-path").value = currentPath;
  await analyzeWorkspace(currentPath);
  await refreshState();
  await loadReleaseReadiness();
  renderLaunchCommand();
  renderCodexCommand();
  setInterval(renderStreamHealth, 10000);
}

async function loadReleaseReadiness() {
  try {
    releaseState = await fetchData("/release/readiness");
    renderOperations();
  } catch {
    releaseState = null;
  }
}

function renderSystem(system) {
  systemState = system;
  const message = system.ready
    ? `Ready · ${system.codex.version}`
    : `Needs Codex · ${system.codex.error || "codex not found"}`;
  $("#system-readiness").textContent = message;
  $("#system-readiness").className = system.ready ? "ready" : "not-ready";
  renderLifecycle();
}

async function refreshState() {
  state = await fetchJson(`/state?path=${encodeURIComponent(workspace?.root || currentPath)}`);
  renderState();
}

async function analyzeWorkspace(path) {
  currentPath = path;
  workspace = await fetchJson(`/workspace/analyze?path=${encodeURIComponent(path)}`);
  renderWorkspace();
  doctor = await fetchData(`/doctor?path=${encodeURIComponent(path)}`);
  renderDoctor();
  connectStream();
}

async function connectWorkspace(path) {
  currentPath = path;
  workspace = await fetchJson("/workspace/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, eventBusUrl: window.location.origin })
  });
  doctor = await fetchData(`/doctor?path=${encodeURIComponent(path)}`);
  renderWorkspace();
  connectStream();
}

async function disconnectWorkspace(path) {
  currentPath = path;
  workspace = await fetchJson("/workspace/disconnect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path })
  });
  doctor = await fetchData(`/doctor?path=${encodeURIComponent(path)}`);
  $("#install-detail").textContent = "Hooks removed";
  renderWorkspace();
  connectStream();
}

async function pickWorkspace() {
  $("#install-detail").textContent = "Opening picker";
  const response = await fetch("/workspace/pick", { method: "POST" });
  const result = await response.json();
  if (result.cancelled) {
    $("#install-detail").textContent = "Picker cancelled";
    return;
  }
  if (!response.ok || result.ok === false) {
    $("#install-detail").textContent = result.error || "Picker unavailable";
    return;
  }
  $("#workspace-path").value = result.path;
  await analyzeWorkspace(result.path);
}

function connectStream() {
  if (streamEvents) streamEvents.close();
  streamState.status = "connecting";
  const path = workspace?.root || currentPath;
  const events = new EventSource(`/stream?path=${encodeURIComponent(path)}`);
  streamEvents = events;
  const snapshotMode = new URLSearchParams(window.location.search).has("e2e_snapshot");
  events.onopen = () => setConnection("live");
  events.onerror = () => {
    streamState.reconnects += 1;
    setConnection("reconnecting");
  };
  events.onmessage = (message) => {
    streamState.lastMessageAt = Date.now();
    const payload = JSON.parse(message.data);
    if (payload.event?.id) {
      streamState.lastEventId = Math.max(streamState.lastEventId || 0, Number(payload.event.id) || 0);
      streamState.lastEventLatencyMs = Math.max(0, Date.now() - Number(payload.event.timestamp || Date.now()));
    }
    if (payload.replay === true && payload.event?.id) {
      replayedEventIds.add(Number(payload.event.id));
      streamState.replayedEvents = replayedEventIds.size;
      streamState.lastReplayAt = Date.now();
    }
    if (payload.state) {
      state = payload.state;
      renderState();
    } else {
      renderStreamHealth();
      renderLifecycle();
    }
    if (snapshotMode) events.close();
  };
}

function renderState() {
  $("#metric-agents").textContent = state.metrics.activeAgents || 0;
  $("#metric-events").textContent = state.metrics.storedEvents ?? state.metrics.totalEvents ?? 0;
  $("#metric-tools").textContent = state.metrics.toolCalls || 0;
  $("#agent-count-label").textContent = state.agents.length || 0;
  renderLifecycle();
  renderStreamHealth();
  renderSwarmGraph();
  renderAgents();
  renderEvents();
  renderOperations();
  renderRepoContext();
  renderQuickstart();
  renderPipeline();
  renderLaunchCommand();
  renderCodexCommand();
}

function renderWorkspace() {
  if (!workspace) return;
  const hookTarget = hookTargetStatus();
  $("#metric-files").textContent = workspace.counts.markdown || 0;
  $("#md-count-label").textContent = workspace.counts.markdown || 0;
  $("#db-count-label").textContent = workspace.databases.length || 0;
  $("#install-state").textContent = hookTarget.ready ? "hooks installed" : hookTarget.stale ? "reconnect hooks" : "hooks not installed";
  $("#install-detail").textContent = hookTarget.ready ? "Connected to this monitor" : hookTarget.stale ? "Hook target changed" : "Ready to connect";
  $("#connect-workspace").textContent = hookTarget.stale ? "Reconnect hooks" : "Install hooks";
  $("#canvas-title").textContent = workspace.name;
  $("#workspace-summary").innerHTML = `
    <div class="workspace-name">${escapeHtml(workspace.name)}</div>
    <div class="workspace-path">${escapeHtml(workspace.root)}</div>
    <div class="check-grid">
      ${checkItem("Codex", workspace.detected.codex)}
      ${checkItem("Hooks", workspace.detected.hooks)}
      ${checkItem("MCP", workspace.detected.mcp)}
      ${checkItem("OMX", workspace.detected.omx)}
      ${checkItem("AGENTS.md", workspace.detected.agents)}
      ${checkItem("RALPH.md", workspace.detected.ralph)}
    </div>
    <div class="trust-note">
      <strong>Hook trust</strong>
      <span>${escapeHtml(relativeWorkspacePath(workspace.trust?.hookPath || workspace.install.hooksPath))}</span>
    </div>
  `;
  renderRepoContext();
  renderHarnessCanvas();
  renderMarkdown();
  renderDatabases();
  renderTrust();
  renderDoctor();
  renderLifecycle();
  renderOperations();
  renderQuickstart();
  renderPipeline();
  renderLaunchCommand();
  renderCodexCommand();
}

function renderRepoContext() {
  const target = $("#repo-context");
  if (!target) return;
  if (!workspace) {
    target.innerHTML = `
      <div class="repo-context-empty">
        <strong>No workspace selected</strong>
        <span>Analyze a local Codex folder to build the harness evidence map.</span>
      </div>
    `;
    return;
  }

  const stages = workspace.harness?.stages || [];
  const activeStages = stages.filter((stage) => stage.state === "active").length;
  const counts = workspace.counts || {};
  const repository = workspace.repository || {};
  const hookTarget = hookTargetStatus();
  const statusPills = [
    { label: repository.hasGit ? repository.branch : "local folder", tone: repository.hasGit ? "blue" : "neutral" },
    { label: workspace.detected.ralph ? "RALPH" : "native Codex", tone: workspace.detected.ralph ? "green" : "neutral" },
    { label: hookTarget.ready ? "hooks installed" : hookTarget.stale ? "hooks stale" : "hooks pending", tone: hookTarget.ready ? "green" : "amber" },
    { label: `${activeStages}/${stages.length || 4} harness`, tone: activeStages === (stages.length || 4) ? "green" : "amber" }
  ];
  const rows = [
    {
      label: "Branch",
      value: repository.branch || "unknown",
      meta: repository.remote || "not configured"
    },
    {
      label: "Harness",
      value: `${activeStages}/${stages.length || 4} stages`,
      meta: stages.map((stage) => stage.state === "active" ? stage.label : `${stage.label}: missing`).join(" · ")
    },
    {
      label: "Evidence",
      value: `${counts.markdown || 0} md · ${counts.codex || 0} codex · ${counts.omx || 0} omx · ${counts.sqlite || 0} db`,
      meta: "Only discovered files, settings, and runtime stores are shown"
    },
    {
      label: "Live path",
      value: `SSE ${$("#connection-state")?.textContent || "connecting"}`,
      meta: hookTarget.ready ? "Codex hook posts to this monitor" : hookTarget.stale ? "Reconnect hooks before expecting live events" : "Install hooks before expecting live events"
    }
  ];
  const repoTabs = [
    { label: "Code", value: compactNumber(repository.worktreeFiles || 0), active: true },
    { label: "Hooks", value: workspace.harness?.hooks?.swarmEvents?.length || 0, active: workspace.install?.configured },
    { label: "Ralph", value: workspace.harness?.ralph?.successCriteria?.length || 0, active: workspace.detected.ralph },
    { label: "Events", value: compactNumber(state.metrics.storedEvents ?? state.metrics.totalEvents ?? 0), active: Number(state.metrics.storedEvents ?? state.metrics.totalEvents ?? 0) > 0 }
  ];

  target.innerHTML = `
    <div class="repo-head">
      <div class="repo-identity">
        <span class="repo-icon">C</span>
        <div>
          <strong>${escapeHtml(workspace.name)}</strong>
          <em>${escapeHtml(relativeWorkspacePath(workspace.root))}</em>
        </div>
      </div>
      <div class="repo-pills">
        ${statusPills
          .map((pill) => `<span class="${pill.tone}">${escapeHtml(pill.label)}</span>`)
          .join("")}
      </div>
    </div>
    <div class="repo-tabs" role="list" aria-label="workspace evidence tabs">
      ${repoTabs
        .map(
          (tab) => `
            <span class="${tab.active ? "active" : ""}" role="listitem">
              ${escapeHtml(tab.label)}
              <strong>${escapeHtml(tab.value)}</strong>
            </span>
          `
        )
        .join("")}
    </div>
    <div class="repo-context-main">
      ${rows
        .map(
          (row) => `
            <article class="repo-context-item">
              <span>${escapeHtml(row.label)}</span>
              <strong>${escapeHtml(row.value)}</strong>
              <em>${escapeHtml(row.meta)}</em>
            </article>
          `
        )
        .join("")}
    </div>
    <div class="repo-context-stages">
      ${stages
        .map(
          (stage, index) => `
            <span class="${stage.state === "active" ? "active" : "missing"}">${index + 1}. ${escapeHtml(stage.label)}</span>
          `
        )
        .join("")}
    </div>
  `;
}

function renderQuickstart() {
  const list = $("#quickstart-list");
  if (!list) return;
  const codexReady = systemState?.ready === true;
  const folderAnalyzed = Boolean(workspace?.root);
  const hookTarget = hookTargetStatus();
  const hooksInstalled = hookTarget.ready;
  const streamLive = $("#connection-state")?.textContent === "live";
  const hasEvents = Number(state.metrics.storedEvents ?? state.metrics.totalEvents ?? 0) > 0;
  const steps = [
    {
      label: "Start the monitor",
      detail: "Runs locally from the standalone app or Codex plugin.",
      ok: Boolean(versionState)
    },
    {
      label: "Confirm Codex",
      detail: codexReady ? systemState.codex.version : "Install or sign in to Codex, then refresh.",
      ok: codexReady
    },
    {
      label: "Choose a workspace",
      detail: folderAnalyzed ? relativeWorkspacePath(workspace.root) : "Pick the project folder where Codex will run.",
      ok: folderAnalyzed
    },
    {
      label: "Install hooks",
      detail: hooksInstalled ? ".codex/codex-swarm-monitor/hook.mjs" : hookTarget.stale ? "Reconnect hooks so Codex posts to this monitor URL." : "Installs project-local hooks without editing Codex itself.",
      ok: hooksInstalled
    },
    {
      label: "Run Codex there",
      detail: hasEvents ? "Real events are streaming." : "Open a terminal in that folder and run codex.",
      ok: hasEvents,
      live: streamLive
    }
  ];
  const complete = steps.filter((step) => step.ok).length;
  $("#quickstart-state").textContent = `${complete}/${steps.length}`;
  list.innerHTML = steps
    .map(
      (step, index) => `
        <article class="quickstart-row ${step.ok ? "ok" : step.live ? "pending" : ""}">
          <span>${index + 1}</span>
          <div>
            <strong>${escapeHtml(step.label)}</strong>
            <p>${escapeHtml(step.detail)}</p>
          </div>
        </article>
      `
    )
    .join("");
}

function renderTrust() {
  const list = $("#trust-list");
  if (!list) return;
  if (!workspace?.trust) {
    $("#trust-state").textContent = "not ready";
    list.innerHTML = `
      <div class="empty empty-state">
        <strong>Select a workspace</strong>
        <span>Hook trust details appear after folder analysis.</span>
      </div>
    `;
    return;
  }

  const hookCoverage = workspace.harness?.hooks || {};
  const installedSwarmEvents = hookCoverage.swarmEvents || [];
  const missingSwarmEvents = hookCoverage.missingSwarmEvents || [];
  const hookCoverageValue = missingSwarmEvents.length
    ? `${installedSwarmEvents.length}/7 lifecycle hooks configured · missing ${missingSwarmEvents.join(", ")}`
    : "7/7 lifecycle hooks configured";
  const eventBusUrl = workspace.trust.eventBusUrl || "not embedded";
  const hookTarget = hookTargetStatus();
  const rows = [
    {
      label: "Approve only this hook",
      value: relativeWorkspacePath(workspace.trust.hookPath),
      tone: workspace.install.configured ? "ok" : "pending"
    },
    {
      label: "Hook config",
      value: relativeWorkspacePath(workspace.trust.hooksPath || workspace.install.hooksPath),
      tone: workspace.detected.hooks ? "ok" : "pending"
    },
    {
      label: "Hook coverage",
      value: hookCoverageValue,
      tone: workspace.install.configured ? "ok" : "pending"
    },
    {
      label: "Event bus",
      value: hookTarget.ready ? eventBusUrl : eventBusUrl === "not embedded" ? "Reconnect this workspace to bind the current monitor URL" : `${eventBusUrl} · reconnect to ${window.location.origin}`,
      tone: hookTarget.ready ? "ok" : "pending"
    },
    {
      label: "Expected command",
      value: workspace.trust.expectedCommand || "installed after Install hooks",
      tone: workspace.install.configured ? "ok" : "pending",
      code: true
    },
    {
      label: "Data boundary",
      value: "Local SQLite, SSE on localhost, secrets redacted before storage",
      tone: "ok"
    },
    {
      label: "No synthetic data",
      value: "Agent cards appear only after real Codex hook or MCP events",
      tone: "ok"
    }
  ];

  $("#trust-state").textContent = hookTarget.ready ? "configured" : hookTarget.stale ? "reconnect" : "review";
  list.innerHTML = `
    <div class="trust-callout">${escapeHtml(workspace.trust.firstRunNotice || "Confirm the hook path before approving Codex trust.")}</div>
    ${rows
      .map(
        (row) => `
          <article class="trust-row ${row.tone}">
            <span></span>
            <div>
              <strong>${escapeHtml(row.label)}</strong>
              ${row.code ? `<code>${escapeHtml(row.value)}</code>` : `<p>${escapeHtml(row.value)}</p>`}
            </div>
          </article>
        `
      )
      .join("")}
  `;
}

function renderLaunchCommand() {
  const target = $("#launch-command");
  if (!target) return;
  const path = workspace?.root || currentPath || "$PWD";
  target.textContent = `codex-swarm-monitor --workspace "${path}" --connect --open`;
}

function hookTargetStatus() {
  const configured = workspace?.install?.configured === true;
  const eventBusUrl = workspace?.trust?.eventBusUrl || "";
  if (!configured) return { configured, ready: false, stale: false, eventBusUrl };
  if (!eventBusUrl) return { configured, ready: false, stale: true, eventBusUrl };
  const ready = eventBusUrl === window.location.origin;
  return { configured, ready, stale: !ready, eventBusUrl };
}

function renderCodexCommand() {
  const target = $("#codex-command");
  if (!target) return;
  const path = workspace?.root || currentPath || "$PWD";
  target.textContent = `cd "${path}" && codex`;
}

async function copyCommand(selector, successText) {
  const command = $(selector)?.textContent || "";
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
    $("#install-detail").textContent = successText;
  } catch {
    $("#install-detail").textContent = command;
  }
}

function renderOperations() {
  const list = $("#ops-list");
  const releasePlan = $("#release-plan");
  if (!list) return;
  const releaseBlockers = releaseState?.blockers || [];
  const releaseWarnings = releaseState?.warnings || [];
  const releaseReady = releaseState?.ok === true;
  const build = versionState
    ? `${versionState.version} · ${versionState.distribution}`
    : "pending";
  const runtime = versionState?.node || "pending";
  const retention = state.retention?.policy || "pending";
  const storedEvents = state.metrics.storedEvents ?? state.metrics.totalEvents ?? 0;
  const retentionInput = $("#retention-max");
  if (retentionInput && document.activeElement !== retentionInput) {
    retentionInput.value = String(state.retention?.maxEvents ?? state.metrics.retentionMaxEvents ?? 50000);
  }
  $("#ops-state").textContent = releaseBlockers.length ? `${releaseBlockers.length} release blockers` : versionState?.distribution || "local";
  const rows = [
    { label: "Build", value: build, tone: "ok" },
    { label: "End-user path", value: versionState?.release?.endUserPath || "Codex plugin + standalone", tone: "ok" },
    {
      label: "User prerequisites",
      value: versionState?.release?.userPrerequisites?.join(", ") || "Codex",
      tone: versionState?.release?.endUsersNeedNode === false && versionState?.release?.endUsersNeedNpm === false ? "ok" : "pending"
    },
    {
      label: "Bundled runtime",
      value: versionState?.release?.bundledRuntime || "Standalone bundles include runtime",
      tone: "ok"
    },
    { label: "Bootstrap", value: versionState?.release?.bootstrap || "standalone first", tone: "ok" },
    {
      label: "Release gate",
      value: releaseReady ? `${releaseState.tag} app release ready` : `${releaseState?.tag || "release"} has ${releaseBlockers.length} required blocker${releaseBlockers.length === 1 ? "" : "s"}`,
      tone: releaseReady ? "ok" : "fail"
    },
    ...releaseBlockers.slice(0, 4).map((item) => ({
      label: labelize(item.id),
      value: item.remediation || item.summary,
      tone: "fail"
    })),
    {
      label: "Optional release checks",
      value: releaseWarnings.length ? `${releaseWarnings.length} warning${releaseWarnings.length === 1 ? "" : "s"}: ${releaseWarnings.slice(0, 2).map((item) => labelize(item.id)).join(", ")}` : "clear",
      tone: releaseWarnings.length ? "pending" : "ok"
    },
    { label: "Runtime", value: runtime, tone: "ok" },
    { label: "Retention", value: retention, tone: "ok" },
    { label: "Stored events", value: compactNumber(storedEvents), tone: "ok" },
    { label: "Mock data", value: versionState?.release?.mockData === false ? "disabled" : "unknown", tone: "ok" },
    { label: "Redaction", value: "enabled", tone: "ok" }
  ];
  list.innerHTML = rows
    .map(
      (item) => `
        <article class="ops-row ${item.tone}">
          <span></span>
          <div>
            <strong>${escapeHtml(item.label)}</strong>
            <p>${escapeHtml(item.value)}</p>
          </div>
        </article>
      `
    )
    .join("");
  if (releasePlan) releasePlan.innerHTML = renderReleasePlan(releaseState?.plan || []);
}

function renderPipeline() {
  const list = $("#pipeline-list");
  if (!list) return;
  const eventCount = Number(state.metrics.storedEvents ?? state.metrics.totalEvents ?? 0);
  const toolCount = Number(state.metrics.toolCalls || 0);
  const lastEvent = state.events?.at(-1);
  const hooksInstalled = workspace?.install?.configured === true;
  const hookEventBus = workspace?.trust?.eventBusUrl || "";
  const hookTarget = hookTargetStatus();
  const streamLive = streamState.status === "live";
  const rows = [
    {
      label: "Monitor API",
      value: versionState ? `${versionState.version} ${versionState.distribution}` : "starting",
      tone: versionState ? "ok" : "pending"
    },
    {
      label: "Workspace",
      value: workspace?.root ? relativeWorkspacePath(workspace.root) || workspace.root : "select a folder",
      tone: workspace?.root ? "ok" : "pending"
    },
    {
      label: "Codex hook",
      value: hooksInstalled ? "7/7 lifecycle hooks configured" : "not installed",
      tone: hooksInstalled ? "ok" : "pending"
    },
    {
      label: "Hook target",
      value: hookEventBus ? (hookTarget.ready ? hookEventBus : `${hookEventBus} · reconnect to ${window.location.origin}`) : "not embedded",
      tone: hookTarget.ready ? "ok" : hooksInstalled ? "pending" : "fail"
    },
    {
      label: "SSE stream",
      value: streamLive ? `live · ${streamState.lastMessageAt ? relativeTime(Date.now() - streamState.lastMessageAt) : "connected"}` : streamState.status,
      tone: streamLive ? "ok" : streamState.status === "reconnecting" ? "pending" : "fail"
    },
    {
      label: "Replay recovery",
      value: streamState.replayedEvents
        ? `${streamState.replayedEvents} replayed · last id ${streamState.lastEventId || "n/a"}`
        : `Last-Event-ID ready${streamState.lastEventId ? ` · last id ${streamState.lastEventId}` : ""}`,
      tone: "ok"
    },
    {
      label: "Event freshness",
      value: lastEvent
        ? `${relativeTime(Date.now() - Number(lastEvent.timestamp || Date.now()))} old${streamState.lastEventLatencyMs == null ? "" : ` · ${Math.round(streamState.lastEventLatencyMs)}ms stream`}`
        : "waiting for first real event",
      tone: lastEvent ? (streamState.lastEventLatencyMs == null || streamState.lastEventLatencyMs < 1000 ? "ok" : "pending") : "pending"
    },
    {
      label: "Event ingest",
      value: eventCount ? `${compactNumber(eventCount)} events · ${compactNumber(toolCount)} tools` : "waiting for real Codex activity",
      tone: eventCount ? "ok" : "pending"
    },
    {
      label: "Last event",
      value: lastEvent ? `${displayName(lastEvent.agent_id)} · ${eventLine(lastEvent)}` : "none yet",
      tone: lastEvent ? "ok" : "pending"
    }
  ];
  const ready = rows.filter((row) => row.tone === "ok").length;
  $("#pipeline-state").textContent = `${ready}/${rows.length}`;
  list.innerHTML = rows
    .map(
      (row) => `
        <article class="pipeline-row ${row.tone}">
          <span></span>
          <div>
            <strong>${escapeHtml(row.label)}</strong>
            <p>${escapeHtml(row.value)}</p>
          </div>
        </article>
      `
    )
    .join("");
}

function renderReleasePlan(plan) {
  if (!plan.length) {
    return `
      <div class="release-plan-title">
        <strong>Release checklist</strong>
        <span>loading</span>
      </div>
      <div class="release-plan-empty">Waiting for local release readiness.</div>
    `;
  }
  return `
    <div class="release-plan-title">
      <strong>Release checklist</strong>
      <span>${plan.filter((item) => item.state === "done").length}/${plan.length}</span>
    </div>
    <div class="release-plan-list">
      ${plan
        .map(
          (item) => `
            <article class="release-step ${escapeHtml(item.state)}">
              <div>
                <strong>${escapeHtml(item.label)}</strong>
                <em>${escapeHtml(item.detail)}</em>
              </div>
              <code>${escapeHtml(item.command)}</code>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

async function updateRetention() {
  const input = $("#retention-max");
  const value = Number(input.value || 0);
  if (!Number.isFinite(value) || value < 0) {
    $("#ops-state").textContent = "invalid";
    return;
  }
  const response = await fetchJson("/settings/retention", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxEvents: Math.floor(value) })
  });
  state.retention = response.retention;
  await refreshState();
}

async function downloadSupportBundle() {
  const path = workspace?.root || currentPath;
  const bundle = await fetchData(`/support/bundle?path=${encodeURIComponent(path)}`);
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `codex-swarm-support-${safeFilename(workspace?.name || "workspace")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("#ops-state").textContent = "support bundle ready";
}

function renderLifecycle() {
  const target = $("#lifecycle-strip");
  if (!target) return;
  const hookTarget = hookTargetStatus();
  const events = Number(state.metrics.storedEvents ?? state.metrics.totalEvents ?? 0);
  const stages = workspace?.harness?.stages || [];
  const activeStages = stages.filter((stage) => stage.state === "active").length;
  const releaseBlockers = releaseState?.blockers || [];
  const releaseWarnings = releaseState?.warnings || [];
  const releaseReady = releaseState?.ok === true;
  const steps = [
    {
      label: "Folder",
      value: workspace?.name || "No folder",
      detail: workspace?.root ? relativeWorkspacePath(workspace.root) || workspace.root : "Choose the local project Codex should observe",
      action: workspace ? "Analyzed" : "Browse or paste a path",
      state: workspace ? "ok" : "pending"
    },
    {
      label: "Codex",
      value: systemState?.codex?.version || "Not detected",
      detail: systemState?.ready ? "Only Codex is required for end users" : "Install and sign in to Codex first",
      action: systemState?.ready ? "Ready" : "Needs attention",
      state: systemState?.ready ? "ok" : "fail"
    },
    {
      label: "Hook",
      value: hookTarget.ready ? "Connected to this monitor" : hookTarget.stale ? "Reconnect required" : "Not installed",
      detail: hookTarget.ready ? "Project-local hook posts 7 lifecycle events to localhost SSE" : "Project-local hook, no Codex source changes",
      action: hookTarget.ready ? "Installed" : hookTarget.stale ? "Reconnect hooks" : "Install hooks",
      state: hookTarget.ready ? "ok" : "pending"
    },
    {
      label: "Harness",
      value: workspace ? `${activeStages}/${stages.length || 4} stages` : "Waiting",
      detail: workspace?.detected?.ralph ? "RALPH loop, criteria, tasks, and verification parsed" : "Native Codex workspace map",
      action: workspace ? "Visualized" : "Analyze folder",
      state: workspace ? (activeStages > 0 ? "ok" : "pending") : "pending"
    },
    {
      label: "Live",
      value: events ? `${events} real events` : "No events yet",
      detail: events ? "Agent cards and logs come from actual hook payloads" : "Run Codex in this folder to populate the canvas",
      action: events ? "Streaming" : "Run codex",
      state: events ? "ok" : $("#connection-state")?.textContent === "live" ? "pending" : "fail"
    },
    {
      label: "Ship",
      value: releaseReady ? `${releaseState.tag} app ready` : releaseBlockers.length ? `${releaseBlockers.length} blockers` : `${releaseWarnings.length} warnings`,
      detail: releaseReady
        ? "App, standalone, realtime, and release artifact checks passed"
        : releaseBlockers.length
          ? releaseBlockers.map((item) => labelize(item.id)).slice(0, 2).join(" · ")
          : "Optional signing or published release visibility checks remain",
      action: releaseReady ? "Ready" : "Finish publishing",
      state: releaseReady ? "ok" : "pending"
    }
  ];
  target.innerHTML = steps
    .map(
      (step, index) => `
        <article class="lifecycle-step ${step.state}">
          <span>${index + 1}</span>
          <div>
            <strong>${escapeHtml(step.label)}</strong>
            <em>${escapeHtml(step.value)}</em>
            <p>${escapeHtml(step.detail)}</p>
            <small>${escapeHtml(step.action)}</small>
          </div>
        </article>
      `
    )
    .join("");
}

function renderDoctor() {
  const list = $("#doctor-list");
  if (!doctor) {
    $("#doctor-state").textContent = "checking";
    list.innerHTML = "";
    return;
  }

  const hardFailures = doctor.checks.filter((item) => !item.ok && !item.optional);
  $("#doctor-state").textContent = hardFailures.length ? `${hardFailures.length} issue${hardFailures.length === 1 ? "" : "s"}` : "ready";
  list.innerHTML = doctor.checks
    .map((item) => {
      const state = item.ok ? "ok" : item.optional ? "pending" : "fail";
      return `
        <article class="doctor-row ${state}">
          <span></span>
          <div>
            <strong>${escapeHtml(labelize(item.id))}</strong>
            <p>${escapeHtml(item.summary)}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderHarnessCanvas() {
  const canvas = $("#harness-canvas");
  const nodes = workspace.hierarchy || [];
  const harnessItems = workspace.harness?.summary || [];
  const loopSignals = workspace.harness?.loops || [];
  const loopStages = workspace.harness?.stages || [];
  const ralphModel = workspace.harness?.ralph || { successCriteria: [], tasks: [] };
  const nodeMarkup = nodes
    .map(
      (node, index) => `
        <article class="harness-node ${escapeHtml(node.kind)}" style="--node-index:${index}">
          <b>${index + 1}</b>
          <span>${escapeHtml(node.kind)}</span>
          <strong>${escapeHtml(node.label)}</strong>
          <em>${node.count} artifacts</em>
        </article>
      `
    )
    .join("");
  const harnessMarkup = harnessItems
    .map(
      (item) => `
        <article class="harness-detail">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(compactNumber(item.value))}</strong>
          <em>${escapeHtml((item.detail || []).map(relativeWorkspacePath).join(" · ") || "not detected")}</em>
        </article>
      `
    )
    .join("");
  const loopMarkup = loopSignals
    .map((signal) => `<span class="${signal.active ? "active" : ""}">${escapeHtml(signal.label)}</span>`)
    .join("");
  const stageMarkup = loopStages
    .map(
      (stage, index) => `
        <article class="ralph-stage ${escapeHtml(stage.state)}">
          <span>${index + 1}</span>
          <div>
            <strong>${escapeHtml(stage.label)}</strong>
            <p>${escapeHtml(stage.detail)}</p>
            <em>${escapeHtml((stage.artifacts || []).map(relativeWorkspacePath).join(" · ") || "not detected")}</em>
          </div>
        </article>
      `
    )
    .join("");
  const criteriaMarkup = renderRalphEvidenceList(ralphModel.successCriteria, "No success criteria found");
  const taskMarkup = renderRalphEvidenceList(ralphModel.tasks, "No implementation tasks found");
  const verificationMarkup = renderRalphCommandList(ralphModel.verificationCommands, "No verification commands found");
  const activeStages = loopStages.filter((stage) => stage.state === "active").length;
  const boardStats = [
    { label: "Instructions", value: compactNumber(workspace.counts?.markdown || 0), meta: "Markdown" },
    { label: "Codex harness", value: compactNumber(workspace.counts?.codex || 0), meta: "Files" },
    { label: "Runtime", value: compactNumber(workspace.counts?.sqlite || 0), meta: "SQLite" },
    { label: "Loop", value: `${activeStages}/${loopStages.length || 4}`, meta: "Stages" }
  ];
  canvas.innerHTML = `
    <svg class="canvas-lines" viewBox="0 0 960 360" aria-hidden="true">
      <path d="M120 180 H300 C344 180 344 92 388 92 H558 C602 92 602 180 646 180 H840" fill="none" stroke="#d0d7de" stroke-width="2"/>
      <path d="M300 180 C352 180 346 268 398 268 H562 C614 268 596 180 648 180" fill="none" stroke="#eaeef2" stroke-width="2"/>
      <circle cx="120" cy="180" r="4" fill="#0969da"/>
      <circle cx="840" cy="180" r="4" fill="#1f883d"/>
    </svg>
    <div class="canvas-board-header">
      <div>
        <span>Repository intelligence</span>
        <strong>${escapeHtml(workspace.name)}</strong>
      </div>
      <div class="canvas-board-stats">
        ${boardStats
          .map(
            (item) => `
              <article>
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value)}</strong>
                <em>${escapeHtml(item.meta)}</em>
              </article>
            `
          )
          .join("")}
      </div>
    </div>
    <div class="harness-nodes">${nodeMarkup}</div>
    <div class="loop-signals">${loopMarkup}</div>
    <div class="ralph-loop-map">
      <div class="ralph-loop-title">
        <strong>Ralph loop map</strong>
        <span>${loopStages.filter((stage) => stage.state === "active").length}/${loopStages.length || 4} active</span>
      </div>
      <div class="ralph-stages">${stageMarkup}</div>
    </div>
    <div class="ralph-evidence">
      <section>
        <div class="ralph-evidence-title">
          <strong>Success criteria</strong>
          <span>${ralphModel.successCriteria?.length || 0}</span>
        </div>
        ${criteriaMarkup}
      </section>
      <section>
        <div class="ralph-evidence-title">
          <strong>Implementation loop</strong>
          <span>${ralphModel.tasks?.length || 0}</span>
        </div>
        ${taskMarkup}
      </section>
      <section>
        <div class="ralph-evidence-title">
          <strong>Verification commands</strong>
          <span>${ralphModel.verificationCommands?.length || 0}</span>
        </div>
        ${verificationMarkup}
      </section>
    </div>
    <div class="harness-details">${harnessMarkup}</div>
    <div class="canvas-caption">
      <strong>${escapeHtml(workspace.root)}</strong>
      <span>${workspace.detected.ralph ? "RALPH loop detected" : "Native Codex workspace"}</span>
    </div>
  `;
}

function renderRalphCommandList(items, emptyText) {
  if (!items?.length) return `<div class="ralph-evidence-empty">${escapeHtml(emptyText)}</div>`;
  return `
    <div class="ralph-evidence-list command-list">
      ${items
        .slice(0, 6)
        .map(
          (item) => `
            <article>
              <span>${escapeHtml(item.id || item.source || "command")}</span>
              <code>${escapeHtml(item.command)}</code>
              <em>${escapeHtml(relativeWorkspacePath(`${item.source}:${item.line || 1}`))}</em>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRalphEvidenceList(items, emptyText) {
  if (!items?.length) return `<div class="ralph-evidence-empty">${escapeHtml(emptyText)}</div>`;
  return `
    <div class="ralph-evidence-list">
      ${items
        .slice(0, 6)
        .map(
          (item) => `
            <article class="${item.state === "done" ? "done" : "open"}">
              <span>${escapeHtml(item.id || item.source || "item")}</span>
              <strong>${escapeHtml(item.label)}</strong>
              <em>${escapeHtml(relativeWorkspacePath(`${item.source}:${item.line || 1}`))}</em>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderMarkdown() {
  const list = $("#markdown-list");
  if (!workspace.markdown.length) {
    list.innerHTML = `<div class="empty">No key Markdown files found.</div>`;
    return;
  }
  list.innerHTML = workspace.markdown
    .map(
      (doc) => `
        <article class="doc-row">
          <strong>${escapeHtml(doc.path)}</strong>
          <span>${doc.lines} lines</span>
          <p>${escapeHtml(doc.headings.slice(0, 3).join(" · ") || "No headings")}</p>
        </article>
      `
    )
    .join("");
}

function renderDatabases() {
  const list = $("#database-list");
  if (!workspace.databases.length) {
    list.innerHTML = `<div class="empty">No Codex/OMX SQLite runtime DBs found.</div>`;
    return;
  }
  list.innerHTML = workspace.databases
    .map(
      (db) => `
        <article class="db-row">
          <strong>${escapeHtml(db.path)}</strong>
          <span>${escapeHtml(Object.entries(db.tableCounts || {}).map(([name, count]) => `${name}:${count}`).join(" · ") || db.error || "No tables")}</span>
        </article>
      `
    )
    .join("");
}

function renderAgents() {
  const grid = $("#agent-grid");
  if (!state.agents.length) {
    const command = $("#codex-command")?.textContent || `cd "${workspace?.root || currentPath || "."}" && codex`;
    const hooksReady = workspace?.install?.configured === true;
    const streamLive = streamState.status === "live";
    grid.innerHTML = `
      <article class="empty empty-state live-empty command-empty">
        <div class="empty-state-head">
          <strong>Ready for real Codex activity</strong>
          <span>${hooksReady ? "Hooks armed" : "Hooks pending"} · ${streamLive ? "SSE live" : streamState.status} · No demo data</span>
        </div>
        <div class="empty-command">
          <code>${escapeHtml(command)}</code>
          <button class="secondary icon-button copy-icon copy-inline-codex" type="button" aria-label="Copy Codex run command" title="Copy Codex run command"><span class="sr-only">Copy</span></button>
        </div>
        <div class="empty-state-steps" aria-label="live agent readiness">
          <span>1. Run Codex in this folder</span>
          <span>2. Native hook posts event</span>
          <span>3. Agent card appears here</span>
        </div>
      </article>
    `;
    return;
  }
  grid.innerHTML = state.agents
    .map((agent) => {
      const currentFile = agent.currentFile || agent.mdFiles?.[0] || "-";
      const action = agent.fileAction || "waiting";
      return `
        <article class="agent-card ${escapeHtml(agent.status)}" style="--rank-color:${rankColors[agent.role] || "#0969da"}">
          <img class="avatar" alt="${escapeHtml(agent.id)} avatar" src="${agent.avatar}" />
          <div class="agent-main">
            <div class="agent-title">
              <strong>${escapeHtml(displayName(agent.id))}</strong>
              <span>${escapeHtml(agent.status)}</span>
            </div>
            <p>${escapeHtml(rankLabel(agent.role))}${agent.parent ? ` · ${escapeHtml(agent.parent)}` : ""}</p>
            <div class="agent-task">${escapeHtml(agent.task)}</div>
            <div class="agent-file"><strong>${escapeHtml(currentFile)}</strong><span>${escapeHtml(action)}</span></div>
            <div class="agent-meta">tokens ${compactNumber(agent.tokens)} · files ${agent.mdFiles?.length || 0} · tools ${agent.toolCount || 0}</div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSwarmGraph() {
  const graph = $("#swarm-graph");
  const edges = state.edges || [];
  if (!edges.length) {
    graph.innerHTML = `<div class="empty compact graph-empty">No spawn relationships yet. Parent-child edges appear when real spawn events arrive.</div>`;
    return;
  }
  const agentById = new Map((state.agents || []).map((agent) => [agent.id, agent]));
  graph.innerHTML = `
    <div class="swarm-graph-title">
      <strong>Swarm relationships</strong>
      <span>${edges.length} edge${edges.length === 1 ? "" : "s"}</span>
    </div>
    <div class="edge-list">
      ${edges
        .map((edge) => {
          const source = agentById.get(edge.source);
          const target = agentById.get(edge.target);
          return `
            <article class="edge-row">
              <span>${escapeHtml(displayName(edge.source))}</span>
              <strong>→</strong>
              <span>${escapeHtml(displayName(edge.target))}</span>
              <em>${escapeHtml(target?.role || source?.role || "Agent")}</em>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderEvents() {
  const log = $("#event-log");
  const events = state.events.slice(-80).reverse();
  if (!events.length) {
    const command = $("#codex-command")?.textContent || `cd "${workspace?.root || currentPath || "."}" && codex`;
    log.innerHTML = `
      <article class="empty empty-state live-empty command-empty">
        <div class="empty-state-head">
          <strong>Event stream armed</strong>
          <span>Workspace-scoped SSE · Last-Event-ID ready · No synthetic events</span>
        </div>
        <div class="empty-command">
          <code>${escapeHtml(command)}</code>
          <button class="secondary icon-button copy-icon copy-inline-codex" type="button" aria-label="Copy Codex run command" title="Copy Codex run command"><span class="sr-only">Copy</span></button>
        </div>
        <div class="empty-state-steps" aria-label="live event readiness">
          <span>0 stored events</span>
          <span>Local SQLite only</span>
          <span>Under 1000ms smoke tested</span>
        </div>
      </article>
    `;
    return;
  }
  log.innerHTML = events
    .map(
      (event) => `
        <article class="event-row ${replayedEventIds.has(Number(event.id)) ? "replayed" : ""}">
          <time>${new Date(event.timestamp).toLocaleTimeString()}${replayedEventIds.has(Number(event.id)) ? ` <span class="replay-badge">replayed</span>` : ""}</time>
          <strong>${escapeHtml(displayName(event.agent_id))}</strong>
          <span>${escapeHtml(eventLine(event))}</span>
        </article>
      `
    )
    .join("");
}

function eventLine(event) {
  const payload = event.payload || {};
  const detail = payload.task || payload.path || payload.summary || payload.command || payload.prompt || "";
  if (event.type.includes("spawn")) return `spawn_subagent(${payload.role || "agent"}) ${detail}`;
  if (event.type.includes("complete")) return `complete · ${payload.result_length || 0} chars`;
  if (event.type.includes("tool")) return `${payload.tool || payload.tool_name || "tool"} · ${detail}`;
  return detail || event.type;
}

function checkItem(label, value) {
  return `<div class="${value ? "ok" : "missing"}"><span></span>${escapeHtml(label)}</div>`;
}

function setConnection(value) {
  streamState.status = value;
  renderStreamHealth();
  renderLifecycle();
}

function renderStreamHealth() {
  const status = streamState.status;
  const stateTarget = $("#connection-state");
  const detailTarget = $("#stream-detail");
  const eventTarget = $("#event-stream-state");
  const card = $("#stream-status-card");
  if (stateTarget) stateTarget.textContent = status;
  if (eventTarget) eventTarget.textContent = status;
  if (card) card.className = `stream-status-card ${status}`;
  if (!detailTarget) return;

  const lastSeen = streamState.lastMessageAt
    ? relativeTime(Date.now() - streamState.lastMessageAt)
    : "no SSE message yet";
  const reconnects = streamState.reconnects ? ` · ${streamState.reconnects} reconnects` : "";
  const replay = streamState.replayedEvents ? ` · ${streamState.replayedEvents} replayed` : "";
  detailTarget.textContent = status === "live" ? `last message ${lastSeen}${reconnects}${replay}` : `${lastSeen}${reconnects}${replay}`;
  renderPipeline();
}

function rankLabel(role) {
  const labels = {
    Orchestrator: "Orchestrator",
    Planner: "Planner",
    Explorer: "Explorer",
    Builder: "Builder",
    Reviewer: "Reviewer",
    Tester: "Tester",
    Leader: "Leader"
  };
  return labels[role] || String(role || "Agent");
}

function displayName(agentId) {
  return String(agentId || "agent").split("-")[0];
}

function labelize(value) {
  return String(value || "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function safeFilename(value) {
  return String(value || "workspace").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `${Math.round(number / 1000)}K`;
  return String(number);
}

function relativeTime(ageMs) {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function relativeWorkspacePath(path) {
  const value = String(path || "");
  const root = String(workspace?.root || "");
  if (root && value.startsWith(`${root}/`)) return value.slice(root.length + 1);
  return value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok || body.ok === false) throw new Error(body.error || `Request failed: ${res.status}`);
  return body;
}

async function fetchData(url, options) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`);
  return body;
}

$("#workspace-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await analyzeWorkspace($("#workspace-path").value);
});

$("#use-current-folder").addEventListener("click", async () => {
  $("#workspace-path").value = currentPath;
  await analyzeWorkspace(currentPath);
});

$("#browse-workspace").addEventListener("click", async () => {
  await pickWorkspace();
});

$("#connect-workspace").addEventListener("click", async () => {
  await connectWorkspace($("#workspace-path").value);
});

$("#disconnect-workspace").addEventListener("click", async () => {
  await disconnectWorkspace($("#workspace-path").value);
});

$("#refresh-workspace").addEventListener("click", async () => {
  await analyzeWorkspace($("#workspace-path").value);
});

$("#clear-events").addEventListener("click", async () => {
  await fetch(`/events?path=${encodeURIComponent(workspace?.root || currentPath)}`, { method: "DELETE" });
  await refreshState();
});

$("#retention-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await updateRetention();
});

$("#download-support").addEventListener("click", async () => {
  await downloadSupportBundle();
});

$("#copy-launch").addEventListener("click", async () => {
  await copyCommand("#launch-command", "Launch command copied");
});

$("#copy-codex").addEventListener("click", async () => {
  await copyCommand("#codex-command", "Codex command copied");
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest?.(".copy-inline-codex");
  if (!button) return;
  await navigator.clipboard.writeText($("#codex-command")?.textContent || "codex");
  const original = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
});

boot().catch((error) => {
  setConnection("offline");
  $("#workspace-summary").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
});
