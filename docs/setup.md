# Setup

## User Path

Only Codex is required in the target workspace. End users should not need Node, npm, OMX, Bun, or a development checkout.

```bash
codex login
```

Primary Codex plugin path after the plugin is available in a Codex marketplace:

```bash
codex plugin add codex-swarm-monitor@codex-swarm-monitor
```

After installing the plugin, ask Codex:

```text
Start the Codex Swarm Monitor for this workspace.
```

The expected Codex behavior is to run the monitor, keep the process alive, open the local URL, and connect the current workspace with native hooks. The plugin skill should not use mock HTML files, seeded dashboards, or synthetic events as evidence that the product is working.

If the plugin cannot find or bootstrap the launcher, treat it as a release publication issue. The failure output names the release version, release base or offline release directory, target platform, and checked install path. End users should not be asked to install Node or npm; publish the matching standalone archive and `.sha256` checksum, or set `CODEX_SWARM_RELEASE_DIR` only for an offline/private install test.

After the monitor starts, use the exact URL printed by the launcher. Port `4000` is the default, but the monitor can fall back to another local port when `4000` is busy. The real initial state should be empty:

```bash
MONITOR_URL="<printed http://127.0.0.1:port URL>"
curl -fsS "$MONITOR_URL/state?path=$PWD"
```

Expect `0` agents and `0` events until Codex runs in that workspace and emits native hook events.

Codex plugin path from a local checkout while developing or testing the marketplace entry:

```bash
codex plugin marketplace add /path/to/codex-swarm-monitor
codex plugin add codex-swarm-monitor@codex-swarm-monitor
```

Then use the same prompt above. The plugin skill bootstraps the standalone runtime when `codex-swarm-monitor` is not already on `PATH`.

The plugin bootstrap installer is version-pinned by default. It derives the GitHub release URL from the plugin manifest repository, downloads from the matching release tag `v0.1.0`, and verifies the `.sha256` before installing; use `CODEX_SWARM_RELEASE_VERSION` or `CODEX_SWARM_RELEASE_BASE` only for release testing.

Fallback direct standalone path after downloading a release bundle:

```bash
tar -xzf codex-swarm-monitor-<platform>-<arch>.tar.gz
./codex-swarm-monitor-<platform>-<arch>/bin/codex-swarm-monitor --workspace /path/to/target-project --connect --open
```

The standalone bundle includes its own Node runtime. Users do not install Node or npm.

Release workflow targets:

- Linux x64: `codex-swarm-monitor-linux-x64`
- macOS Apple Silicon: `codex-swarm-monitor-darwin-arm64`
- macOS Intel: `codex-swarm-monitor-darwin-x64`
- Windows x64: `codex-swarm-monitor-win32-x64`

Open `http://127.0.0.1:4000`, paste the target project folder path if needed, then check:

1. `Analyze folder`
2. Hook Trust shows `7/7 lifecycle hooks configured` when started with `--connect`
3. Click `Install hooks` only if you started without `--connect`

Then run Codex from the target folder:

```bash
cd /path/to/target-project
codex
```

The installed workspace hook is copied into `.codex/codex-swarm-monitor/hook.mjs`, so it does not import from this development checkout or require OMX.

To start with a folder already selected after standalone install:

```bash
codex-swarm-monitor --workspace /path/to/target-project --connect --open
```

If port `4000` is busy, the monitor automatically chooses a free local port and prints the URL.

Run preflight checks without starting the server:

```bash
codex-swarm-monitor --workspace /path/to/target-project --doctor
```

Create a local support bundle without starting the server:

```bash
codex-swarm-monitor --workspace /path/to/target-project --support > codex-swarm-support.json
```

The same checks are available in the app's `Preflight` panel and at `GET /doctor?path=...`. A fresh Codex workspace may ask for hook trust the first time Codex sees `.codex/hooks.json`; accept the project-local hook after confirming the path is `.codex/codex-swarm-monitor/hook.mjs`.

Developer-only local source workflow for the monitor itself:

```bash
cd /path/to/codex-swarm-monitor
npm install
npm run dev -- --workspace "$PWD" --connect --open
```

For npm package verification only, the package also supports:

```bash
npx codex-swarm-monitor --workspace /path/to/target-project --connect --open
```

## Developer Checks

```bash
npm test
npm run lint
npm run package:smoke
npm run plugin:smoke
npm run standalone:smoke
npm run runtime:smoke
node tools/agent-spawner/test_spawn.mjs
```

Or run the full release gate:

```bash
npm run verify
```
