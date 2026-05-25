---
name: codex-swarm-monitor
description: Start, diagnose, and connect the local Codex Swarm Monitor for a workspace. Use when the user wants to watch Codex activity live, install monitor hooks, run preflight checks, or visualize AGENTS/RALPH/OMX harness structure.
---

# Codex Swarm Monitor

Use this skill to operate the local monitor from inside Codex.

## Action Contract

When the user asks to start, open, run, connect, or watch a workspace with Codex Swarm Monitor, do the work directly. Do not stop at setup instructions unless the user explicitly asks for instructions only.

1. Start from the user's current workspace unless they gave another folder.
2. Prefer `codex-swarm-monitor --workspace "$PWD" --connect --open`.
3. If the launcher is missing, run the plugin start script for the current platform; it bootstraps the standalone runtime and then starts the monitor.
4. Keep the monitor process running and report the printed local URL.
5. Tell the user to run Codex from that same folder only after hook installation is confirmed.

Never open or reference old `swarm-ui-mockup.html`, seed dashboards, DiceBear demos, or synthetic event generators as proof of success. Empty agent cards are valid until real Codex hook or MCP events arrive.

## Codex-Only User Promise

For normal users, Codex is the only prerequisite. Do not ask them to install Node, npm, Bun, OMX, Python, or this source checkout. The plugin start script must either:

1. find a matching installed `codex-swarm-monitor` launcher,
2. bootstrap the matching standalone release archive and checksum, or
3. fail with a release-operations error that names the missing release assets.

If bootstrap fails, report it as a publication problem, not a user setup problem. Tell the user the required release tag, target platform, and checked install path from the error output. The correct remediation is to publish the matching standalone archive/checksum or set `CODEX_SWARM_RELEASE_DIR` for an offline install; `CODEX_SWARM_ALLOW_NPX=1` is only for package verification fallback.

After a successful start, verify the real endpoints before saying it is working. Use the exact URL printed by the launcher because port `4000` can fall back to another local port when it is busy:

```bash
MONITOR_URL="<printed http://127.0.0.1:port URL>"
curl -fsS "$MONITOR_URL/health"
curl -fsS "$MONITOR_URL/workspace/analyze?path=$PWD"
curl -fsS "$MONITOR_URL/state?path=$PWD"
```

The expected initial live state is `0` agents and `0` events. That empty state is production-correct until Codex runs in the connected folder and emits native hook events.

## Start The Monitor

Use this order. It lets a Codex user start the monitor without OMX or manual Node project setup:

```bash
codex-swarm-monitor --workspace "$PWD" --connect --open
```

If that command is not on `PATH`, run the Node-free plugin start script. It bootstraps the standalone release bundle through the plugin installer, then starts the monitor:

```bash
plugins/codex-swarm-monitor/scripts/start-monitor.sh --workspace "$PWD" --connect
```

On Windows from the plugin checkout:

```powershell
powershell -ExecutionPolicy Bypass -File plugins/codex-swarm-monitor/scripts/start-monitor.ps1 --workspace "$PWD" --connect
```

Manual standalone install from the plugin checkout:

```bash
plugins/codex-swarm-monitor/scripts/install-standalone.sh
codex-swarm-monitor --workspace "$PWD" --connect --open
```

Manual Windows standalone install from the plugin checkout:

```powershell
powershell -ExecutionPolicy Bypass -File plugins/codex-swarm-monitor/scripts/install-standalone.ps1
codex-swarm-monitor.cmd --workspace "$PWD" --connect --open
```

The plugin installer derives its GitHub release URL from the plugin manifest repository, defaults to the matching release tag `v0.1.0`, and verifies the downloaded `.sha256` before running the bundled installer. Use `CODEX_SWARM_RELEASE_VERSION` or `CODEX_SWARM_RELEASE_BASE` only for testing another release source.

After the app opens, use the `Launch Checklist` in the left rail. It should progress from monitor startup to Codex detection, workspace analysis, hook installation, and finally real live events. Do not create fake events to fill the dashboard.

Fallback end-user path after the user downloads and extracts a release bundle:

```bash
./bin/codex-swarm-monitor --workspace "$PWD" --connect --open
```

If they ran the bundle installer:

```bash
codex-swarm-monitor --workspace "$PWD" --connect --open
```

## Developer Source Checkout

Use this only when developing this monitor repository itself. Do not present it as an end-user path:

```bash
node apps/backend/src/index.mjs --workspace "$PWD" --connect --open
```

Do not silently fall back to mock data or synthetic events. The plugin start script only uses npm when `CODEX_SWARM_ALLOW_NPX=1` is explicitly set for package verification.

## Preflight

Run:

```bash
codex-swarm-monitor --workspace "$PWD" --doctor
```

or:

```bash
plugins/codex-swarm-monitor/scripts/start-monitor.sh --workspace "$PWD" --doctor
```

Explain any failed checks directly. `hook-installed` is optional before the user clicks `Install hooks`; `codex-doctor` failures should be treated as real environment issues.

## Connect A Workspace

1. Start the monitor.
2. Open the printed local URL.
3. If started with `--connect`, confirm the Hook Trust panel shows `7/7 lifecycle hooks configured`.
4. If started without `--connect`, click `Install hooks`.
5. Run Codex from that same folder.

If the user asks whether it is working, verify with the real local endpoints instead of relying on a screenshot:

```bash
MONITOR_URL="<printed http://127.0.0.1:port URL>"
curl -fsS "$MONITOR_URL/health"
curl -fsS "$MONITOR_URL/workspace/analyze?path=$PWD"
curl -fsS "$MONITOR_URL/release/readiness"
```

The expected workspace analysis should show project-local hook coverage, and the release readiness response should include a `plan` checklist. Real live activity appears only after Codex runs in the connected folder.

If the browser or local port is unavailable, create a support bundle from the CLI without starting the server:

```bash
codex-swarm-monitor --workspace "$PWD" --support > codex-swarm-support.json
```

The installed hook path should be:

```text
.codex/codex-swarm-monitor/hook.mjs
```

Codex may ask the user to trust the hook the first time it sees the workspace hook config. This is expected; the user should confirm the path above before trusting.

## Verification

Use the project release gate before calling the monitor production-ready:

```bash
npm run verify
```

The app must not require demo or seed events. Empty live state is valid until real Codex hooks or MCP events arrive.
