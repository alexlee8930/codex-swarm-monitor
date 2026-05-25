# Codex Swarm Monitor

Local production-shaped observability app for Codex workspaces.

The app does not require `oh-my-codex` for end users. A user can install Codex, start this app from the Codex plugin or standalone bundle, and use `--connect` to install project-local Codex hooks for the selected folder at startup. If the folder already has OMX/Ralph artifacts, the analyzer surfaces them; if it does not, the monitor still works with native Codex hooks.

## Run

End-user promise: after Codex is installed, the user starts this through the Codex plugin marketplace or a released standalone bundle. They do not install Node, npm, Bun, OMX, or this source checkout. The runtime bundle includes Node, the plugin/start command installs project-local Codex hooks with `--connect`, and the live dashboard stays empty until real Codex events arrive.

Primary Codex plugin path after the plugin is available in a Codex marketplace:

```bash
codex plugin add codex-swarm-monitor@codex-swarm-monitor
```

Then ask Codex:

```text
Start the Codex Swarm Monitor for this workspace.
```

The plugin skill starts the monitor, keeps the local process running, opens the printed URL, and uses `--connect` so native workspace hooks are installed. It should not use the old mockup HTML or synthetic events to prove success.

If the plugin cannot bootstrap the launcher, that is a release publication problem rather than a user setup step. The error output names the missing release version, target platform, release source, and checked install path. Users should not be asked to install Node or npm; publish the matching standalone archive and `.sha256` checksum, or use `CODEX_SWARM_RELEASE_DIR` only for an offline release test.

Fallback direct standalone path, after downloading a release bundle for your OS:

```bash
tar -xzf codex-swarm-monitor-<platform>-<arch>.tar.gz
./codex-swarm-monitor-<platform>-<arch>/bin/codex-swarm-monitor --workspace /path/to/codex-project --connect --open
```

This bundle includes its own Node runtime. Users do not install Node or npm.

Release artifacts are built for:

- `codex-swarm-monitor-linux-x64`
- `codex-swarm-monitor-darwin-arm64`
- `codex-swarm-monitor-darwin-x64`
- `codex-swarm-monitor-win32-x64`

Each archive is accompanied by a `.sha256` checksum when the runner provides `tar`. The GitHub release workflow also generates artifact provenance attestations for the archive and checksum with GitHub Actions artifact attestations. When release secrets are configured, the workflow additionally performs macOS signing and notarization for the bundled runtime and Windows Authenticode signing for the bundled runtime before regenerating checksums.

Optional local install from inside the extracted bundle:

```bash
./install.sh
codex-swarm-monitor --workspace /path/to/codex-project --connect --open
```

The installer copies the app and bundled runtime into a stable local install root, then writes a launcher into `$PREFIX/bin` or `$HOME/.local/bin`. On Windows, run `install.ps1`, then launch `codex-swarm-monitor.cmd`.

Developer marketplace test path from a local plugin checkout:

```bash
codex plugin marketplace add /path/to/codex-swarm-monitor
codex plugin add codex-swarm-monitor@codex-swarm-monitor
plugins/codex-swarm-monitor/scripts/start-monitor.sh --workspace "$PWD"
```

Windows plugin checkout:

```powershell
powershell -ExecutionPolicy Bypass -File plugins/codex-swarm-monitor/scripts/start-monitor.ps1 --workspace "$PWD"
```

The plugin manifest includes a marketplace screenshot captured from the real local app with empty live events and real workspace analysis; it is not a seeded demo dashboard. Refresh it with `npm run screenshot:marketplace` before building the plugin package.

The plugin bootstrap installer derives the GitHub release URL from the plugin manifest repository, downloads the standalone archive from the matching release tag `v0.1.0`, verifies the `.sha256`, and only then runs the bundled installer. Override `CODEX_SWARM_RELEASE_VERSION` or `CODEX_SWARM_RELEASE_BASE` only when testing another release source.

Release publishing also builds a `codex-swarm-monitor-plugin-<version>.tar.gz` package containing the Codex plugin manifest, skill, bootstrap scripts, marketplace manifest, and marketplace screenshot, plus a `.sha256` checksum. `npm run marketplace:submission` then wraps the plugin archive, checksum, screenshot, marketplace notes, `submission.json`, and release asset manifest into `codex-swarm-monitor-marketplace-submission-<version>.tar.gz` for Codex marketplace review.

For npm package verification only:

```bash
npx codex-swarm-monitor --workspace "$PWD" --connect --open
```

For local development:

```bash
npm install
npm run dev -- --workspace "$PWD" --connect --open
```

Open `http://127.0.0.1:4000`.

Useful CLI options:

```bash
codex-swarm-monitor --workspace /path/to/project --port 4000 --connect --open
codex-swarm-monitor --workspace . --port 0
codex-swarm-monitor --version
codex-swarm-monitor --version --json
codex-swarm-monitor --workspace . --doctor
codex-swarm-monitor --workspace . --doctor --json
codex-swarm-monitor --workspace . --support > codex-swarm-support.json
```

Port `4000` is the default. If it is already in use, the app falls back to an available local port and prints the exact URL.

## Use With Any Local Codex Folder

The first screen includes a `Launch Checklist` that tracks the real setup state:

- monitor process started
- Codex detected
- workspace analyzed
- hooks installed
- live events received from Codex

This checklist is status-only. It does not create sample agents or preload demo events.

1. Enter the absolute folder path in the top bar.
2. Click `Analyze folder` to inspect `.codex`, `.omx`, Markdown instructions, Ralph files, and runtime SQLite databases.
3. If the monitor was started with `--connect`, confirm Hook Trust shows `7/7 lifecycle hooks configured`. Otherwise click `Install hooks` to write a self-contained project-local `.codex/codex-swarm-monitor/hook.mjs` plus `.codex/hooks.json`.
4. Start Codex from that same folder.

```bash
cd /path/to/your/codex-project
codex
```

As Codex uses tools, the app receives hook events at `POST /events`, stores them in SQLite, and pushes live updates to the UI over `GET /stream`. The UI requests `/state?path=<workspace>` and `/stream?path=<workspace>` so the selected folder only shows events whose hook `cwd` belongs to that workspace. SSE messages include event IDs, and reconnects use `Last-Event-ID` to replay missed workspace events before the current state snapshot. The SSE stream also emits lightweight heartbeat messages so the browser can show live connection health without creating synthetic events or storing extra rows. The hook script copied into the workspace has no dependency on this repository path, so a workspace remains connected after installation as long as the monitor server is running.

Codex may ask to trust the newly installed hook on first use. That is expected for a fresh workspace. The app exposes the exact hook path, hook config path, expected command, and local-only privacy boundary in the `Hook Trust` panel. The same readiness checks are available through the `Preflight` panel and `GET /doctor?path=...`.

The app surface tracks the product path as `Folder -> Codex -> Hook -> Stream`. This is a status pipeline backed by `/workspace/analyze`, `/system`, `/workspace/connect`, and `/stream`; it does not create synthetic agents or demo events.

The repository-style workspace header and harness canvas include a `Ralph loop map` built only from discovered files and settings: instructions, agent/prompt definitions, hooks/MCP configuration, and runtime evidence such as SQLite databases, logs, and state snapshots. Missing stages stay visibly missing instead of being filled with demo data.

Click `Clear events` to remove only events scoped to the selected workspace path. Click `Uninstall hooks` to remove only the Codex Swarm Monitor hook entries and `.codex/codex-swarm-monitor` runtime from that workspace. Existing unrelated Codex hooks are preserved.

Build identity and release posture are exposed through `codex-swarm-monitor --version`, `codex-swarm-monitor --version --json`, `GET /version`, `npm run release:readiness`, and `GET /release/readiness`. The Operations panel uses this metadata to show that the end-user prerequisite is Codex only, the end-user path is Codex plugin plus standalone bundle, mock data is disabled, realtime transport is SSE, and any remaining public-release blockers have concrete remediation steps. It also renders a release checklist with the exact local verification, tag, artifact, plugin package, and GitHub release commands required to move from source checkout to public assets. Standalone bundles also include `manifest.json` and `app/build-info.json` next to the bundled runtime.

For support and release triage, the Operations panel can download a local support bundle from `GET /support/bundle?path=...`, and the CLI can emit the same bundle with `codex-swarm-monitor --workspace <path> --support`. The bundle includes product metadata, workspace/Ralph analysis, preflight doctor checks, release readiness, retention metadata, and recent redacted event summaries. It does not create synthetic events or contact a hosted service.

The local event store keeps the latest `50000` events by default. Override the startup default with `CODEX_SWARM_MAX_EVENTS=<count>`; set `CODEX_SWARM_MAX_EVENTS=0` for unlimited local retention. The Operations panel can also change retention for the running monitor through `POST /settings/retention`, and the store prunes immediately when the limit is lowered.

Event payloads are redacted before persistence. Common secret fields and token-looking values such as API keys, bearer tokens, GitHub tokens, Slack tokens, passwords, and private keys are replaced with `[redacted]` in the local SQLite store and streamed state.

The local API only grants browser CORS access to same-origin loopback callers (`localhost`, `127.0.0.1`, or `::1`). Codex hooks and the plugin launcher run as local processes and can post without an Origin header, while unrelated external web pages cannot use CORS to inject synthetic events into the monitor.

## What It Observes

- Native Codex hook lifecycle events.
- Tool names and shell command summaries.
- Markdown files referenced by commands and tool inputs.
- MCP `spawn_subagent` lifecycle events when the optional bundled `agent_spawner` server is enabled.
- Existing workspace structure: `.codex`, `.omx`, `AGENTS.md`, `RALPH.md`, important Markdown files, and SQLite runtime DB table counts.
- Fresh-machine readiness checks from the bundled/development runtime, Codex, `codex doctor`, workspace permissions, and hook installation state.
- Local retention metadata through `/state.retention` and `metrics.storedEvents`.
- Local secret redaction for hook payloads before SQLite persistence or SSE broadcast.
- SSE reconnect replay through `Last-Event-ID` for missed workspace events.

## Verification

```bash
npm run verify
npm run release:audit
npm run release:readiness
npm run artifact:audit
npm run bootstrap:smoke
npm run codex-only:smoke
npm run codex-plugin:smoke
npm run fresh:smoke
npm run release:remote-smoke
npm run standalone:build
npm run standalone:build:all
curl -f http://127.0.0.1:4000/health
```

`npm run verify` runs syntax checks, Node tests, the packaged tarball smoke test, local avatar smoke test, Codex plugin smoke test, Codex CLI plugin install smoke when Codex is available, plugin package smoke test, standalone bundle smoke test, artifact checksum/manifest audit, plugin bootstrap install smoke test, packaged Codex-only plugin smoke test, fresh-machine smoke test, realtime SSE/UI smoke test, runtime browser/API smoke test, and the optional MCP spawner dry-run. The CI workflow runs this product gate on Linux, macOS, and Windows for pull requests and pushes to `main`. `npm run release:verify` is the public-release gate: it runs the product gate, builds the Linux, macOS Apple Silicon, macOS Intel, and Windows x64 standalone archives from official Node runtimes, builds the marketplace submission, verifies the full release asset set, and prints release readiness. The marketplace submission smoke extracts the review bundle, verifies the screenshot, plugin archive, release asset manifest, no-mock/no-remote-avatar claims, Codex-only user promise, and absence of development app source. The avatar smoke verifies every core role gets a distinct deterministic local SVG portrait with no remote provider. The realtime smoke starts the monitor on a temporary workspace, opens the workspace-scoped SSE stream, posts real hook-shaped events, verifies the live SSE message contains the agent state and v7 local avatar, enforces under-1000ms local SSE delivery, then checks the rendered UI agent card and Event freshness row when Chrome is available. The artifact audit rebuilds the standalone archive, verifies the `.sha256` file, extracts the archive, confirms the manifest has no build-machine absolute paths, and runs the extracted launcher. The release audit verifies that release workflows create GitHub artifact provenance attestations for standalone archives and checksum files, and that optional macOS signing/notarization plus Windows Authenticode signing paths are present. `npm run release:readiness` and `GET /release/readiness` report the public-release prerequisites that cannot be proven from source alone, including Git remote, version tag, all Linux/macOS/Windows standalone artifacts and checksums, the Codex plugin release package and checksum, Codex marketplace submission bundle, Codex marketplace publication verification, signing secrets, GitHub CLI access, published GitHub release visibility, and published release asset completeness; each failing check includes a remediation, the CLI output includes a release checklist with exact commands, and `-- --strict` fails when any release prerequisite is missing. The bootstrap smoke verifies the plugin's shell installer can install the standalone runtime from release artifacts without relying on an npm project. The Codex-only smoke extracts the published plugin package shape into a temporary folder, confirms it does not contain the development source app or `package.json`, and starts through the plugin script using only release artifacts. The fresh-machine smoke installs the standalone bundle into a temporary home, deletes the extracted bundle folder, starts the installed launcher, connects a new workspace, executes the installed Codex hook, and verifies that a real event appears in `/state` with no mock data. The runtime smoke starts the CLI on a random local port and verifies the real UI entrypoint; when Chrome or Chromium is available it captures desktop, tablet, and mobile PNG screenshots, checks their dimensions, and rejects blank renders.

The public release procedure is maintained in [docs/release.md](docs/release.md). It is the authoritative runbook for publishing the standalone assets, plugin package, GitHub release, and Codex marketplace entry.

Before tagging a public release, run `npm run release:sync-source` after configuring `git origin`. This aligns the plugin manifest release URLs with the public GitHub release source that end-user Codex installs will download from.

The privacy and data-boundary statement is maintained in [docs/privacy.md](docs/privacy.md). The marketplace submission notes shipped with the plugin package are in [plugins/codex-swarm-monitor/MARKETPLACE.md](plugins/codex-swarm-monitor/MARKETPLACE.md).

## Current Boundary

This is a local-first app, not a hosted multi-tenant SaaS. The repo is now an npm CLI package, a Codex plugin source, and a standalone release bundle that includes Node. The release workflow builds Linux, macOS, and Windows standalone artifacts and contains optional signing/notarization paths gated by release secrets. The remaining release work is public marketplace/publishing ownership, a real signed/notarized release run with production certificates, Codex hook-trust UX validation across external fresh machines, and LiteLLM/OpenInference model-request capture.
