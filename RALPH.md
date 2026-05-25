# Task

Build a local-first Codex Swarm Monitor that works for any Codex workspace.

The app lets a user choose a local folder, analyze its Codex/OMX/Ralph harness structure, install native Codex hooks, and watch tool/subagent activity in real time.

# Stack

- Backend: Node 24 HTTP server + `node:sqlite`
- CLI: `codex-swarm-monitor --workspace <path> --connect --open`, with automatic hook installation and free-port fallback
- Standalone release: `dist/codex-swarm-monitor-<platform>-<arch>` includes its own Node runtime
- Release workflow: GitHub Actions builds Linux x64, macOS arm64, macOS x64, and Windows x64 artifacts
- Codex plugin: root `.codex-plugin/plugin.json`, marketplace metadata, and skill entrypoint
- Preflight: `codex-swarm-monitor --workspace <path> --doctor` and `GET /doctor?path=...`
- Realtime: Server-Sent Events at `GET /stream`
- UI: White canvas workspace interface served by the backend
- Hooks: target workspace `.codex/hooks.json` runs copied `.codex/codex-swarm-monitor/hook.mjs`
- MCP: optional target workspace `.codex/config.toml` can register `agent_spawner`
- Avatars: local Notion-style SVG portraits through `/avatar`

# Success Criteria

- [SC-1] User can run the app and analyze a local folder path.
- [SC-2] Analyzer detects `.codex`, `.omx`, `AGENTS.md`, `RALPH.md`, Markdown files, and SQLite runtime DBs.
- [SC-3] `Install hooks` writes self-contained project-local Codex hooks without requiring OMX or this checkout path.
- [SC-4] Event bus accepts `POST /events`, persists to SQLite, and returns state via `GET /state`.
- [SC-5] SSE stream pushes event/state updates in real time.
- [SC-6] UI renders a white canvas harness view, live agent cards, Markdown files, runtime DBs, and event log.
- [SC-7] UI and CLI expose preflight checks for Node, Codex, Codex doctor, workspace permissions, and hook install state.
- [SC-8] Repository validates as a Codex plugin source with a monitor operation skill.
- [SC-9] Standalone release bundle starts without requiring a user-installed Node/npm runtime.
- [SC-10] Release workflow builds and uploads cross-platform standalone artifacts.
- [SC-11] Packaged Codex plugin can bootstrap from release artifacts without the development source tree or npm project.
- [SC-12] No sample traffic is required for the product flow.

# Verification Commands

```bash
npm test
npm run lint
npm run package:smoke
npm run plugin:smoke
npm run plugin:package:smoke
npm run standalone:smoke
npm run bootstrap:smoke
npm run codex-only:smoke
npm run fresh:smoke
npm run runtime:smoke
npm run verify
node tools/agent-spawner/test_spawn.mjs
curl -fsS http://127.0.0.1:4000/health
curl -fsS "http://127.0.0.1:4000/workspace/analyze?path=$PWD"
```

# Follow-Up Scope

- Publish the Codex marketplace plugin and matching standalone release artifacts so users only need Codex.
- Add signed desktop wrapper or tray app for non-terminal users.
- Add LiteLLM/OpenInference export for Tier 3 model-call introspection.
- Add visual regression thresholds beyond the current runtime smoke screenshot check.
