# Public Release Runbook

This runbook is the release path for the "Codex only" user promise. A public user should install Codex, add the Codex Swarm Monitor plugin from the Codex marketplace, and start the local monitor without installing Node, npm, Bun, OMX, or this source checkout.

## Release Gate

Run the full local gate before publishing:

```bash
npm run screenshot:marketplace
npm run verify
npm run release:verify
npm run release:audit
npm run release:readiness -- --strict
```

`npm run verify` must include:

- `npm run plugin:smoke`
- `npm run plugin:package:smoke`
- `npm run avatar:smoke`
- `npm run standalone:smoke`
- `npm run artifact:audit`
- `npm run bootstrap:smoke`
- `npm run codex-only:smoke`
- `npm run fresh:smoke`
- `npm run realtime:smoke`
- `npm run runtime:smoke`

## Publish Source

Create the public repository remote and push the release source:

```bash
git remote add origin <repo-url>
git push -u origin HEAD
```

Sync the plugin marketplace metadata to the GitHub origin before tagging. This is what makes the Codex-only bootstrap download standalone archives from the correct public release:

```bash
npm run release:sync-source
```

Tag the release source:

```bash
git tag v0.1.0
git push origin HEAD v0.1.0
```

The GitHub release workflow builds these standalone archives and `.sha256` files:

- `codex-swarm-monitor-linux-x64.tar.gz`
- `codex-swarm-monitor-darwin-arm64.tar.gz`
- `codex-swarm-monitor-darwin-x64.tar.gz`
- `codex-swarm-monitor-win32-x64.tar.gz`
- `codex-swarm-monitor-darwin-arm64.app.tar.gz`
- `codex-swarm-monitor-darwin-x64.app.tar.gz`

## Collect And Verify Assets

Build all platform standalone bundles locally from official Node runtimes:

```bash
npm run standalone:build:all
```

Or download GitHub Actions artifacts after the release workflow runs:

```bash
gh run download --dir dist
```

Build the Codex plugin package:

```bash
npm run screenshot:marketplace
npm run plugin:package
npm run marketplace:submission
```

Verify the complete release asset set:

```bash
npm run release:artifacts -- dist
```

The release must include:

- all four standalone archives
- all four standalone `.sha256` checksum files
- both macOS `.app` wrapper archives
- both macOS `.app` wrapper `.sha256` checksum files
- `codex-swarm-monitor-plugin-0.1.0.tar.gz`
- `codex-swarm-monitor-plugin-0.1.0.tar.gz.sha256`
- `codex-swarm-monitor-marketplace-submission-0.1.0.tar.gz`
- `codex-swarm-monitor-marketplace-submission-0.1.0.tar.gz.sha256`

## Publish GitHub Release

Create or update the GitHub release with every archive and checksum. Keep the `find` depth capped so extracted marketplace submission contents are not uploaded as duplicate assets:

```bash
mapfile -t release_assets < <(
  find dist -maxdepth 1 -type f \( -name '*.tar.gz' -o -name '*.sha256' -o -name '*.zip' -o -name '*.zip.sha256' \) -print | sort
)

if gh release view v0.1.0 >/dev/null 2>&1; then
  gh release upload v0.1.0 "${release_assets[@]}" --clobber
else
  gh release create v0.1.0 "${release_assets[@]}" --title v0.1.0
fi
```

Then inspect the release:

```bash
npm run release:readiness
npm run release:readiness -- --remote
npm run release:remote-smoke
npm run release:desktop-remote-smoke
```

## Publish Codex Marketplace Plugin

Before submitting, build and review the packaged marketplace submission:

```bash
npm run marketplace:submission
tar -tzf dist/codex-swarm-monitor-marketplace-submission-0.1.0.tar.gz
sed -n '1,220p' plugins/codex-swarm-monitor/MARKETPLACE.md
npm run release:remote-smoke
npm run release:desktop-remote-smoke
CODEX_SWARM_REQUIRE_CODEX_PLUGIN_SMOKE=1 npm run codex-plugin:smoke
```

Publish `codex-swarm-monitor-marketplace-submission-0.1.0.tar.gz` to the target Codex marketplace using the marketplace publishing process. After publication, verify from a clean Codex install:

```bash
codex plugin add codex-swarm-monitor@codex-swarm-monitor
```

Then ask Codex:

```text
Start the Codex Swarm Monitor for this workspace.
```

Expected behavior:

- the plugin starts or bootstraps the standalone runtime
- no user-installed Node/npm is required
- `--connect --open` is used for normal startup
- Hook Trust shows `7/7 lifecycle hooks configured`
- live agent/event panels stay empty until real Codex activity happens
- Realtime Pipeline shows SSE and `Replay recovery`

After this external verification succeeds, set the release readiness marker for the final strict check:

```bash
CODEX_SWARM_MARKETPLACE_PUBLISHED=1 npm run release:readiness -- --strict
```

## Optional Signing

For a trusted public release, configure these GitHub Actions secrets before tagging:

- `MACOS_CERTIFICATE_P12_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_CODESIGN_IDENTITY`
- `MACOS_NOTARY_APPLE_ID`
- `MACOS_NOTARY_TEAM_ID`
- `MACOS_NOTARY_PASSWORD`
- `WINDOWS_CERTIFICATE_PFX_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`

Signing is optional for source verification but expected before a broad public launch.

## Do Not Ship

Do not publish a release that requires any of these for end users:

- Node
- npm
- Bun
- OMX
- this source checkout
- demo events
- seed events
- remote avatar providers

The app must use real Codex hooks, local SQLite, workspace-scoped SSE, `Last-Event-ID` replay, and local `/avatar` SVG portraits.
