# Research Notes

Captured on 2026-05-24. Updated on 2026-05-25.

## Product Reference Findings

- OpenAI's Codex CLI is installed with npm and runs locally from the terminal. The official CLI page states the npm install path as `npm i -g @openai/codex` and documents MCP as a Codex CLI capability.
- OpenAI's Docs MCP page shows Codex can add MCP servers through `codex mcp add ...` or direct `config.toml` entries under `[mcp_servers.<name>]`.
- Oh My Codex remains useful when a workspace already uses OMX/Ralph, but the product path should not require it. The app now installs native Codex hooks into any selected folder.
- GitHub Primer is an open design system with foundations for color, typography, spacing, layout, component primitives, accessibility, responsive behavior, and efficient product surfaces. The monitor follows that with dense repository-style rails, predictable controls, and low-contrast borders instead of decorative cards.
- Primer's layout guidance maps directly to this app: repository-style pages work well with side navigation, filtering, list-detail surfaces, and clear status summaries, so the monitor uses a split workspace layout rather than a centered marketing page.
- Notion's 2026 release notes highlight dashboard views and a redesigned sidebar. The monitor mirrors the useful product pattern, not the brand: compact navigation, scannable workspace metadata, and a central canvas that carries the active work.
- Goodnotes' whiteboard product describes an infinite canvas for connected ideas, planning, mind mapping, and returning to saved work. The monitor uses a white notebook canvas for harness/Ralph analysis and contextual rails for files, databases, and events.
- Linear's 2026 UI refresh emphasizes scan speed, workflow navigation, consistent headers, redrawn icons, and a main content area that stands out from dimmer navigation. The monitor follows that by keeping controls in the header, status in a narrow pipeline, and live activity in predictable rails.

## Re-Verified Design References, 2026-05-25

- GitHub Primer remains the strongest structural reference because it is built for dense developer surfaces: repository headers, horizontal top navigation, side panes, low-contrast dividers, accessible responsive layout, and scannable status surfaces.
- Primer layout guidance supports the monitor's current reading order: global controls first, status strip second, side rails plus central content third. That maps to `topbar`, `launch-strip`, `status-strip`, and the three-column `workspace-layout`.
- GitHub's current repository and pull request docs reinforce the same structure: users navigate from the repository main page into horizontal `Issues` and `Pull requests` tabs, then filter and sort dense lists in place. The monitor mirrors that pattern with repo tabs, filters-as-status pills, and a persistent workspace header rather than a marketing hero.
- GitHub's code review product page frames pull requests as the central coordination surface and shows contextual diffs, timeline history, and status checks. The monitor borrows that product behavior by keeping hook trust, Ralph evidence, realtime stream state, and release readiness visible next to the workspace canvas.
- Notion's recent product direction supports compact workspace navigation and in-context dashboards. The monitor should copy that information architecture pattern, not Notion branding: left setup/trust rail, center canvas, right operations/event rail.
- Notion's sidebar guide positions the sidebar as the navigation hub for organizing pages, templates, settings, search, inbox, and workspace switching. The monitor uses this as the rationale for the sticky left rail: workspace setup, hook trust, and key Markdown stay available while the user inspects the central harness canvas.
- Goodnotes whiteboard confirms the canvas metaphor: harness and Ralph loop visualization should feel like a persistent notebook/whiteboard where related artifacts stay spatially grouped.
- Goodnotes' current whiteboard page describes an infinite-canvas surface for planning, brainstorming, connecting ideas, and moving from exploration to execution. The monitor maps that to a white canvas for folder hierarchy, Ralph loop stages, success criteria, verification commands, and live agent state.
- Linear's refresh reinforces the need for scan speed and focus. The monitor therefore keeps the UI quiet, white, low-shadow, and information-dense instead of using a dark "swarm command center" theme.

## Current UI Decisions

- Keep the app white, canvas-like, and quiet: `--canvas`, `--notebook`, `--paper`, restrained borders, no dark swarm board.
- Keep the top-level structure product-like rather than demo-like: repository navigation, sticky context rails, and a primary canvas that can be inspected without fake activity.
- Treat setup as a status pipeline, not a tutorial: `Folder -> Codex -> Hook -> Harness -> Live -> Ship`.
- Keep live data empty until real Codex hooks or MCP events arrive.
- Use local deterministic SVG portraits from `/avatar`; no remote avatar providers and no synthetic agent roster.
- Make the harness canvas the primary object after folder selection: workspace hierarchy, loop signals, hook events, MCP servers, and runtime DBs are visible together.

## Local Evidence

- `codex --version`: `codex-cli 0.133.0`
- The current repo has OMX artifacts, but tests also verify hook/config installation into a temporary folder without OMX.

## Design Decision

Use native Codex Tier 1 as the default product path, and Tier 2 MCP when users opt into subagent spawning:

- Tier 1: Codex native hooks post events to `POST /events`.
- Tier 2: MCP `spawn_subagent` launches child Codex processes and emits lifecycle events.
- Tier 3 LiteLLM / Arize-style request introspection remains a follow-up because it requires proxying model traffic and handling sensitive prompt data.

UI avatars use local Notion-style SVG portraits generated by `/avatar`. This removes CDN dependence and keeps agent identity deterministic without demo data.

Sources:

- OpenAI Codex CLI: https://developers.openai.com/codex/cli
- OpenAI Docs MCP: https://developers.openai.com/learn/docs-mcp
- Oh My Codex docs: https://oh-my-codex.dev/docs.html
- GitHub Primer design system: https://primer.github.io/design/
- GitHub Primer source: https://github.com/primer/design
- GitHub Primer introduction: https://primer.github.io/design/guides/introduction/
- Primer layout guidance: https://primer.style/foundations/layout
- Primer accessibility guidance: https://primer-docs-preview.github.com/accessibility/
- GitHub repository issue/PR filtering docs: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests
- GitHub code review product page: https://github.com/features/code-review
- Notion sidebar guide: https://www.notion.com/en-gb/help/guides/navigating-with-the-sidebar
- Notion 3.4 release notes: https://www.notion.com/en-gb/releases/2026-03-26
- Goodnotes whiteboard: https://www.goodnotes.com/tools/whiteboard
- Goodnotes whiteboard support: https://support.goodnotes.com/hc/en-us/articles/13693350308751-Whiteboard
- Linear UI refresh: https://linear.app/changelog/2026-03-12-ui-refresh
- Goodnotes web: https://www.goodnotes.com/web
