# Codex Swarm Monitor Marketplace Submission

## Listing Summary

Codex Swarm Monitor starts a local realtime dashboard for a Codex workspace. It analyzes Codex/Ralph harness files, installs project-local native Codex hooks, and visualizes live tool and agent activity over local SSE.

## User Promise

The public user path requires Codex only:

```bash
codex plugin add codex-swarm-monitor@codex-swarm-monitor
```

Then the user asks Codex:

```text
Start the Codex Swarm Monitor for this workspace.
```

The plugin starts or bootstraps the standalone runtime, uses `--connect --open`, and keeps data local.

## Capabilities

- Start and connect the local monitor.
- Run preflight checks.
- Install and uninstall project-local Codex hooks.
- Analyze `AGENTS.md`, `RALPH.md`, `.codex`, `.omx`, Markdown files, and SQLite runtime databases.
- Show workspace-scoped realtime SSE activity with `Last-Event-ID` replay.
- Generate local Notion-style SVG portraits.
- Create local support bundles.

## Data Boundary

- No hosted service.
- No telemetry.
- No demo or seed events.
- No remote avatar provider.
- Local SQLite event store.
- Localhost-only browser API.
- Secrets are redacted before persistence and SSE broadcast.

## Bootstrap

If `codex-swarm-monitor` is not already installed, the plugin bootstrap downloads the matching standalone release archive and `.sha256`, verifies the checksum, installs the bundled runtime, and then starts the monitor.

The bootstrap does not require users to install Node, npm, Bun, or OMX.

## Verification

Before marketplace publication, run:

```bash
npm run verify
npm run release:audit
npm run release:remote-smoke
CODEX_SWARM_REQUIRE_CODEX_PLUGIN_SMOKE=1 npm run codex-plugin:smoke
npm run codex-only:smoke
npm run plugin:package
npm run release:artifacts -- dist
```

After marketplace publication, verify from a clean Codex install:

```bash
codex plugin add codex-swarm-monitor@codex-swarm-monitor
```

Then run the default prompt and confirm:

- Hook Trust shows `7/7 lifecycle hooks configured`.
- Realtime Pipeline shows SSE and `Replay recovery`.
- Live panels remain empty until real Codex activity occurs.
- No Node/npm/source checkout is required for the user path.
