#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const packageJson = readJson("package.json");
const gitignore = read(".gitignore");
assert.equal(packageJson.bin["codex-swarm-monitor"], "apps/backend/src/index.mjs");
assert.equal(packageJson.bin["codex-swarm-hook"], "scripts/codex-swarm-hook.mjs");
assert.ok(packageJson.files.includes("apps"));
assert.ok(packageJson.files.includes("plugins"));
assert.ok(packageJson.files.includes(".agents"));
assert.match(packageJson.scripts.verify, /fresh:smoke/, "release verification must include fresh-machine smoke");
assert.match(packageJson.scripts.verify, /artifact:audit/, "release verification must include artifact audit");
assert.match(packageJson.scripts.verify, /avatar:smoke/, "release verification must include local avatar smoke");
assert.match(packageJson.scripts.verify, /bootstrap:smoke/, "release verification must include plugin bootstrap smoke");
assert.match(packageJson.scripts.verify, /codex-only:smoke/, "release verification must include packaged Codex-only smoke");
assert.match(packageJson.scripts.verify, /codex-plugin:smoke/, "release verification must include real Codex plugin install smoke when Codex is available");
assert.match(packageJson.scripts.verify, /realtime:smoke/, "release verification must include realtime SSE/UI smoke");
assert.match(packageJson.scripts.verify, /release:sync-source:smoke/, "release verification must include release source sync smoke");
assert.match(packageJson.scripts.verify, /desktop:smoke/, "release verification must include the desktop app wrapper smoke");
assert.match(packageJson.scripts["release:verify"], /marketplace:submission:smoke/, "release verification must include marketplace submission smoke");
assert.match(packageJson.scripts["release:verify"], /standalone:build:all/, "release verification must build all platform standalone assets");
assert.match(packageJson.scripts["release:verify"], /release:artifacts -- dist/, "release verification must check the full release asset set");
assert.equal(packageJson.scripts["release:remote-smoke"], "node scripts/remote-release-bootstrap-smoke.mjs");
assert.equal(packageJson.scripts["release:desktop-remote-smoke"], "node scripts/remote-desktop-app-smoke.mjs");
assert.equal(packageJson.scripts["avatar:smoke"], "node scripts/avatar-smoke.mjs");
assert.equal(packageJson.scripts["realtime:smoke"], "node scripts/realtime-smoke.mjs");
assert.equal(packageJson.scripts["screenshot:marketplace"], "node scripts/refresh-marketplace-screenshot.mjs");
assert.equal(packageJson.scripts["marketplace:submission"], "node scripts/build-marketplace-submission.mjs");
assert.equal(packageJson.scripts["marketplace:submission:smoke"], "node scripts/marketplace-submission-smoke.mjs");
assert.equal(packageJson.scripts["codex-plugin:smoke"], "node scripts/codex-plugin-install-smoke.mjs");
assert.equal(packageJson.scripts["release:sync-source"], "node scripts/sync-plugin-release-source.mjs");
assert.equal(packageJson.scripts["release:sync-source:smoke"], "node scripts/sync-release-source-smoke.mjs");
assert.equal(packageJson.scripts["standalone:build:all"], "node scripts/build-release-artifacts.mjs");
assert.equal(packageJson.scripts["desktop:app"], "node scripts/build-desktop-app.mjs");
assert.equal(packageJson.scripts["desktop:smoke"], "node scripts/desktop-app-smoke.mjs");
assert.match(packageJson.scripts.lint, /avatar-smoke\.mjs/);
assert.match(packageJson.scripts.lint, /realtime-smoke\.mjs/);
assert.match(packageJson.scripts.lint, /refresh-marketplace-screenshot\.mjs/);
assert.match(packageJson.scripts.lint, /build-desktop-app\.mjs/);
assert.match(packageJson.scripts.lint, /desktop-app-smoke\.mjs/);
assert.match(packageJson.scripts.lint, /build-release-artifacts\.mjs/);
assert.match(packageJson.scripts.lint, /build-marketplace-submission\.mjs/);
assert.match(packageJson.scripts.lint, /codex-plugin-install-smoke\.mjs/);
assert.match(packageJson.scripts.lint, /marketplace-submission-smoke\.mjs/);
assert.match(packageJson.scripts.lint, /remote-desktop-app-smoke\.mjs/);
assert.match(packageJson.scripts.lint, /remote-release-bootstrap-smoke\.mjs/);
assert.match(packageJson.scripts.lint, /sync-plugin-release-source\.mjs/);
assert.match(packageJson.scripts.lint, /sync-release-source-smoke\.mjs/);
assert.equal(packageJson.scripts["release:readiness"], "node scripts/release-readiness.mjs");
assert.match(gitignore, /^\.codex\/$/m, "public repo must ignore local Codex runtime/config state");
assert.doesNotMatch(gitignore, /^!\.codex\/(config\.toml|hooks\.json|agents|prompts|skills)/m);

const standaloneBuilder = read("scripts/build-standalone.mjs");
assert.match(standaloneBuilder, /process\.execPath/, "standalone bundle must copy the current Node runtime");
assert.match(standaloneBuilder, /--target/, "standalone bundle must support explicit release targets");
assert.match(standaloneBuilder, /--node-runtime/, "standalone bundle must support externally supplied runtimes");
assert.match(standaloneBuilder, /bundle: basename\(bundleRoot\)/, "standalone manifest must use relative bundle identity");
assert.match(standaloneBuilder, /build-info\.json/, "standalone bundle must include runtime build metadata");
assert.match(standaloneBuilder, /install\.sh/, "standalone bundle must include a POSIX installer");
assert.match(standaloneBuilder, /install\.ps1/, "standalone bundle must include a Windows installer");
assert.match(standaloneBuilder, /lib\/codex-swarm-monitor/, "installer must copy runtime into a stable install root");
assert.match(standaloneBuilder, /sha256/, "standalone archives must get checksums");
const desktopBuilder = read("scripts/build-desktop-app.mjs");
assert.match(desktopBuilder, /Codex Swarm Monitor\.app/, "desktop builder must create a macOS app bundle");
assert.match(desktopBuilder, /desktop-manifest\.json/, "desktop app bundle must include desktop build metadata");
assert.match(desktopBuilder, /--workspace "\$HOME" --open/, "desktop app must open the monitor without auto-installing hooks into home");
assert.match(desktopBuilder, /\.app\.tar\.gz/, "desktop app builder must archive app bundles");
assert.match(desktopBuilder, /--build-standalone/, "desktop app builder must make standalone rebuilding explicit");
assert.match(read("scripts/desktop-app-smoke.mjs"), /--version", "--json"/, "desktop smoke must execute the app launcher on native macOS");
const remoteDesktopSmoke = read("scripts/remote-desktop-app-smoke.mjs");
assert.match(remoteDesktopSmoke, /\.app\.tar\.gz/, "remote desktop smoke must download the published app wrapper archive");
assert.match(remoteDesktopSmoke, /desktop-manifest\.json/, "remote desktop smoke must inspect desktop app metadata");
assert.match(remoteDesktopSmoke, /verifyChecksum/, "remote desktop smoke must validate the published app checksum");
assert.match(remoteDesktopSmoke, /--version", "--json"/, "remote desktop smoke must execute the downloaded app launcher on native macOS");
const releaseArtifactBuilder = read("scripts/build-release-artifacts.mjs");
assert.match(releaseArtifactBuilder, /nodejs\.org\/dist\/\$\{nodeVersion\}/);
assert.match(releaseArtifactBuilder, /verifyChecksum/);
assert.match(releaseArtifactBuilder, /build-desktop-app\.mjs/, "all-platform release builder must emit macOS app wrappers");
for (const target of ["linux-x64", "darwin-arm64", "darwin-x64", "win32-x64"]) {
  assert.match(releaseArtifactBuilder, new RegExp(target));
}

const workflow = read(".github/workflows/release.yml");
const ciWorkflow = read(".github/workflows/ci.yml");
assert.match(ciWorkflow, /pull_request/);
assert.match(ciWorkflow, /ubuntu-latest/);
assert.match(ciWorkflow, /macos-14/);
assert.match(ciWorkflow, /windows-latest/);
assert.match(ciWorkflow, /npm run verify/);
assert.match(ciWorkflow, /actions\/checkout@v5/);
assert.match(ciWorkflow, /actions\/setup-node@v5/);
assert.match(ciWorkflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true/);
assert.match(workflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true/);
assert.match(workflow, /actions\/checkout@v5/);
assert.match(workflow, /actions\/setup-node@v5/);
assert.match(workflow, /actions\/upload-artifact@v7/);
assert.match(workflow, /actions\/download-artifact@v8/);
assert.match(workflow, /macos-15-intel/, "release workflow must build macOS Intel on a current Intel runner label");
assert.doesNotMatch(workflow, /macos-13/, "release workflow must not use the retired macOS 13 runner label");
for (const artifact of [
  "codex-swarm-monitor-linux-x64",
  "codex-swarm-monitor-darwin-arm64",
  "codex-swarm-monitor-darwin-x64",
  "codex-swarm-monitor-win32-x64"
]) {
  assert.match(workflow, new RegExp(artifact));
}
assert.match(workflow, /npm run verify/);
assert.match(workflow, /desktop-app-smoke\.mjs --target \$\{\{ matrix\.artifact \}\} --no-build-standalone/, "release workflow must not overwrite signed standalone archives while building app wrappers");
assert.match(workflow, /npm run release:sync-source/);
assert.ok(
  workflow.indexOf("Sync Codex plugin release source") < workflow.indexOf("Build Codex plugin package"),
  "release workflow must sync plugin release source before packaging the Codex plugin"
);
assert.match(workflow, /gh release create/);
assert.match(workflow, /gh release upload "\$GITHUB_REF_NAME" "\$\{release_assets\[@\]\}" --clobber/);
assert.match(workflow, /gh release edit "\$GITHUB_REF_NAME"/);
assert.match(workflow, /find release-artifacts -maxdepth 3 -type f/);
assert.match(workflow, /find dist -maxdepth 1 -type f/);
assert.doesNotMatch(workflow, /README-STANDALONE\.md[\s\S]*gh release create/);
assert.doesNotMatch(workflow, /find release-artifacts -type f -maxdepth 3/);
assert.match(workflow, /id-token: write/);
assert.match(workflow, /attestations: write/);
assert.match(workflow, /actions\/attest@v4/);
assert.match(workflow, /subject-path: dist\/\$\{\{ matrix\.artifact \}\}\*/, "release attestation must cover standalone and app wrapper artifacts");
assert.match(workflow, /MACOS_CERTIFICATE_P12_BASE64/);
assert.match(workflow, /codesign --force --options runtime --timestamp/);
assert.match(workflow, /xcrun notarytool submit/);
assert.match(workflow, /WINDOWS_CERTIFICATE_PFX_BASE64/);
assert.match(workflow, /Set-AuthenticodeSignature/);
assert.match(workflow, /Get-AuthenticodeSignature/);
assert.match(workflow, /\.zip\.sha256/);
assert.match(workflow, /awk -v name="\$\{\{ matrix\.artifact \}\}\.tar\.gz"/, "signed macOS tar checksum must use archive basename");
assert.match(workflow, /awk -v name="\$\{\{ matrix\.artifact \}\}\.zip"/, "notarized macOS zip checksum must use archive basename");
assert.match(workflow, /"\$hash  \$\{\{ matrix\.artifact \}\}\.tar\.gz"/, "signed Windows checksum must use archive basename");

const readme = read("README.md");
assert.match(readme, /Users do not install Node or npm/);
assert.match(readme, /docs\/release\.md/);
assert.match(readme, /docs\/privacy\.md/);
assert.match(readme, /MARKETPLACE\.md/);
assert.match(readme, /Primary macOS app path/);
assert.match(readme, /Optional Codex plugin path/);
assert.match(readme, /Developer marketplace test path from a local plugin checkout/);
assert.ok(
  readme.indexOf("Primary macOS app path") < readme.indexOf("Fallback direct standalone path"),
  "README must present the app as the first end-user run path"
);
assert.ok(
  readme.indexOf("Fallback direct standalone path") < readme.indexOf("For npm package verification only"),
  "README npm/npx instructions must stay below end-user plugin and standalone paths"
);
assert.match(readme, /For npm package verification only/);
assert.match(readme, /start-monitor\.sh --workspace "\$PWD"/);
assert.match(readme, /npx codex-swarm-monitor --workspace "\$PWD" --connect --open/);
assert.match(readme, /native Codex hooks/i);
assert.match(readme, /Folder -> Codex -> Hook -> Stream/);
assert.match(readme, /Ralph loop map/);
assert.match(readme, /Launch Checklist/);
assert.match(readme, /Hook Trust/);
assert.match(readme, /Uninstall hooks/);
assert.match(readme, /codex-swarm-monitor --version/);
assert.match(readme, /--connect --open/);
assert.match(readme, /GET \/version/);
assert.match(readme, /mock data is disabled/);
assert.match(readme, /macOS signing and notarization/);
assert.match(readme, /Windows Authenticode signing/);
assert.match(readme, /npm run release:readiness/);
assert.match(readme, /npm run release:remote-smoke/);
assert.match(readme, /npm run release:desktop-remote-smoke/);
assert.match(readme, /CODEX_SWARM_MAX_EVENTS/);
assert.match(readme, /POST \/settings\/retention/);
assert.match(readme, /metrics\.storedEvents/);
assert.match(readme, /redacted/);
assert.match(readme, /bundled\/development runtime/);
assert.match(read("apps/backend/src/store.mjs"), /redactSecrets/);
assert.match(read("plugins/codex-swarm-monitor/.codex-plugin/plugin.json"), /docs\/privacy\.md/);
assert.match(read("plugins/codex-swarm-monitor/.codex-plugin/plugin.json"), /LICENSE/);
assert.match(read("apps/backend/src/store.mjs"), /AVATAR_VERSION = 7/);
assert.match(read("apps/backend/src/store.mjs"), /v=\$\{AVATAR_VERSION\}/);
assert.match(read("apps/backend/src/server.mjs"), /data-avatar-version="7"/);
assert.match(read("apps/backend/src/system.mjs"), /Bundled runtime/);
assert.match(read("apps/backend/src/system.mjs"), /Use the standalone bundle or Codex plugin bootstrap/);
assert.match(read("apps/backend/src/server.mjs"), /workspace\/disconnect/);
assert.match(read("apps/backend/src/server.mjs"), /localOriginPolicy/);
assert.doesNotMatch(read("apps/backend/src/server.mjs"), /Access-Control-Allow-Origin": "\*"/);
assert.match(read("test/server.test.mjs"), /only grants CORS to same-origin localhost callers/);
assert.match(read("apps/backend/src/index.mjs"), /--connect/);
assert.match(read("apps/backend/src/index.mjs"), /installWorkspace/);
assert.match(read("apps/backend/src/workspace.mjs"), /uninstallWorkspace/);
assert.match(read("apps/backend/src/workspace.mjs"), /CODEX_HOOK_EVENTS/);
for (const hookEvent of ["SessionStart", "PreToolUse", "PostToolUse", "UserPromptSubmit", "PreCompact", "PostCompact", "Stop"]) {
  assert.match(read("apps/backend/src/workspace.mjs"), new RegExp(`"${hookEvent}"`), `workspace installer must cover ${hookEvent}`);
}
assert.match(read("apps/backend/src/workspace.mjs"), /missingSwarmEvents/);
assert.match(read("test\/workspace.test.mjs"), /requiring complete swarm coverage/);
assert.match(read("apps/ui/index.html"), /ops-panel/);
assert.match(read("apps/ui/index.html"), /pipeline-panel/);
assert.match(read("apps/ui/index.html"), /lifecycle-strip/);
assert.match(read("apps/ui/index.html"), /retention-form/);
assert.match(read("apps/ui/index.html"), /repo-context/);
assert.match(read("apps/ui/index.html"), /stream-detail/);
assert.match(read("apps/ui/index.html"), /event-stream-state/);
assert.match(read("apps/ui/index.html"), /quickstart-panel/);
assert.match(read("apps/ui/index.html"), /trust-panel/);
assert.match(read("apps/ui/index.html"), /launch-command/);
assert.match(read("apps/ui/index.html"), /repo-command-strip/);
assert.match(read("apps/ui/index.html"), /production-workspace-layout/);
assert.match(read("apps/ui/index.html"), /canvas-proof-strip/);
assert.match(read("apps/ui/index.html"), /notion-app-shell/);
assert.match(read("apps/ui/index.html"), /app-sidebar/);
assert.match(read("apps/ui/index.html"), /app-inspector/);
assert.match(read("apps/ui/index.html"), /Local Notion-style avatars/);
assert.match(read("apps/ui/app.js"), /fetchJson\("\/version"\)/);
assert.match(read("apps/ui/app.js"), /renderOperations/);
assert.match(read("apps/ui/app.js"), /renderPipeline/);
assert.match(read("apps/ui/app.js"), /Hook target/);
assert.match(read("apps/ui/app.js"), /hookTargetStatus/);
assert.match(read("apps/ui/app.js"), /Reconnect hooks/);
assert.match(read("apps/backend/src/workspace.mjs"), /readEmbeddedEventBusUrl/);
assert.match(read("apps/ui/app.js"), /updateRetention/);
assert.match(read("apps/backend/src/server.mjs"), /settings\/retention/);
assert.match(read("apps/backend/src/store.mjs"), /setRetention/);
assert.match(read("apps/ui/app.js"), /renderQuickstart/);
assert.match(read("apps/ui/app.js"), /renderRepoContext/);
assert.match(read("apps/ui/app.js"), /renderStreamHealth/);
assert.match(read("apps/ui/app.js"), /Ready for real Codex activity/);
assert.match(read("apps/ui/app.js"), /Event stream armed/);
assert.match(read("apps/ui/app.js"), /Under 1000ms smoke tested/);
assert.match(read("apps/ui/app.js"), /copy-inline-codex/);
assert.match(read("apps/ui/app.js"), /lastMessageAt/);
assert.match(read("apps/ui/app.js"), /lastEventLatencyMs/);
assert.match(read("apps/ui/app.js"), /Event freshness/);
assert.match(read("apps/ui/app.js"), /Replay recovery/);
assert.match(read("apps/ui/app.js"), /Last-Event-ID ready/);
assert.match(read("apps/ui/app.js"), /replayedEventIds/);
assert.match(read("apps/ui/app.js"), /Finish publishing/);
assert.match(read("apps/ui/app.js"), /Only Codex is required for end users/);
assert.match(read("apps/ui/app.js"), /Project-local hook, no Codex source changes/);
assert.match(read("apps/ui/app.js"), /Agent cards and logs come from actual hook payloads/);
assert.match(read("apps/ui/styles.css"), /\.event-row\.replayed/);
assert.match(read("apps/ui/styles.css"), /\.replay-badge/);
assert.match(read("apps/ui/styles.css"), /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
assert.match(read("apps/ui/styles.css"), /\.lifecycle-step p/);
assert.match(read("apps/ui/styles.css"), /\.command-empty/);
assert.match(read("apps/ui/styles.css"), /\.empty-command/);
const uiCss = read("apps/ui/styles.css");
assert.match(uiCss, /--canvas: #f7f7f4/);
assert.match(uiCss, /--canvas-warm: #fbfaf7/);
assert.match(uiCss, /max-width: 1920px/);
assert.match(uiCss, /\.canvas-proof-strip/);
assert.match(uiCss, /display: flex/);
assert.match(uiCss, /\.notion-app-shell/);
assert.match(uiCss, /\.app-sidebar/);
assert.match(uiCss, /\.app-inspector/);
assert.match(uiCss, /background: #f7f7f5/);
assert.match(uiCss, /--notebook: #fffdfa/);
assert.match(uiCss, /\.copy-icon::before/);
assert.match(uiCss, /\.sr-only/);
assert.match(uiCss, /\.repo-nav[\s\S]*rgba\(247, 247, 245, 0\.88\)/);
assert.match(uiCss, /\.workspace-picker[\s\S]*border: 1px solid var\(--soft-line\)/);
assert.match(uiCss, /\.left-rail,[\s\S]*\.right-rail[\s\S]*position: sticky/);
assert.match(uiCss, /\.harness-canvas[\s\S]*var\(--notebook\)/);
assert.doesNotMatch(uiCss, /gradient orbs|bokeh|blob/i);
assert.match(read("apps/backend/src/server.mjs"), /heartbeat/);
const localMachinePathPattern = new RegExp([
  "/Users/",
  "yuchan",
  "lee",
  "|local-agent-mode-",
  "sessions|Application%20",
  "Support|computer://"
].join(""));
for (const path of ["README.md", "docs/setup.md", "docs/release.md", "prd.md"]) {
  const source = read(path);
  assert.doesNotMatch(source, localMachinePathPattern, `${path} must not publish local machine paths`);
}
assert.match(read("apps/backend/src/server.mjs"), /Last-Event-ID|last-event-id/);
assert.match(read("apps/backend/src/server.mjs"), /replayMissedEvents/);
assert.match(read("apps/backend/src/store.mjs"), /after\(id = 0/);
assert.match(read("apps/backend/src/store.mjs"), /latestId/);
assert.match(read("test/server.test.mjs"), /heartbeat messages without storing events/);
assert.match(read("test/server.test.mjs"), /replays missed events after Last-Event-ID/);
assert.match(read("test/store.test.mjs"), /replay events after an SSE last event id/);
assert.match(read("apps/backend/src/store.mjs"), /matchesWorkspace/);
assert.match(read("apps/backend/src/store.mjs"), /countFor/);
assert.match(read("test/store.test.mjs"), /before applying the state limit/);
assert.match(read("apps/backend/src/server.mjs"), /selectedWorkspace/);
assert.match(read("apps/ui/app.js"), /\/state\?path=/);
assert.match(read("apps/ui/app.js"), /\/stream\?path=/);
assert.match(read("apps/ui/app.js"), /\/events\?path=/);
assert.match(read("test/server.test.mjs"), /scoped to the selected workspace path/);
assert.match(read("test/server.test.mjs"), /clears events only for the selected workspace path/);
assert.match(read("apps/ui/app.js"), /Only discovered files, settings, and runtime stores are shown/);
assert.match(read("apps/ui/app.js"), /renderTrust/);
assert.match(read("apps/ui/app.js"), /Hook coverage/);
assert.match(read("apps/ui/app.js"), /7\/7 lifecycle hooks configured/);
assert.match(read("apps/ui/app.js"), /ralph-loop-map/);
assert.match(read("apps/ui/app.js"), /renderRalphEvidenceList/);
assert.match(read("apps/ui/app.js"), /renderRalphCommandList/);
assert.match(read("apps/ui/app.js"), /Verification commands/);
assert.match(read("apps/backend/src/workspace.mjs"), /extractRalphLoop/);
assert.match(read("apps/backend/src/workspace.mjs"), /extractSuccessCriteria/);
assert.match(read("apps/backend/src/workspace.mjs"), /extractVerificationCommands/);
assert.match(read("apps/backend/src/workspace.mjs"), /isTaskSection/);
assert.match(read("apps/backend/src/workspace.mjs"), /inferLoopStages/);
assert.match(read("apps/backend/src/workspace.mjs"), /Runtime evidence/);
assert.match(read("apps/ui/app.js"), /Approve only this hook/);
assert.match(read("apps/ui/app.js"), /Local SQLite, SSE on localhost, secrets redacted/);
assert.match(read("apps/ui/app.js"), /End-user path/);
assert.match(read("apps/ui/app.js"), /User prerequisites/);
assert.match(read("apps/ui/app.js"), /Bundled runtime/);
assert.match(read("apps/ui/app.js"), /Mock data/);
assert.match(read("apps/ui/index.html"), /copy-launch/);
assert.match(read("apps/ui/index.html"), /codex-command/);
assert.match(read("apps/ui/index.html"), /copy-codex/);
assert.match(read("apps/backend/src/meta.mjs"), /macOS app \+ standalone bundle/);
assert.match(read("apps/backend/src/meta.mjs"), /userPrerequisites: \["Codex"\]/);
assert.match(read("apps/backend/src/meta.mjs"), /endUsersNeedNode: false/);
assert.match(read("apps/backend/src/meta.mjs"), /endUsersNeedNpm: false/);
assert.match(read("apps/backend/src/meta.mjs"), /mockData: false/);
assert.match(readme, /GET \/stream/);
assert.match(readme, /GET \/doctor\?path=\.\.\./);
assert.match(readme, /codex-only:smoke/);
assert.match(readme, /fresh:smoke/);
const research = read("docs/research.md");
for (const source of ["GitHub Primer", "Notion", "Goodnotes", "Linear"]) {
  assert.match(research, new RegExp(source), `research must document ${source} design reference`);
}
assert.match(research, /Re-Verified Design References, 2026-05-25/);
assert.match(research, /repository navigation, sticky context rails, and a primary canvas/);
assert.match(research, /Folder -> Codex -> Hook -> Harness -> Live -> Ship/);
assert.match(research, /horizontal `Issues` and `Pull requests` tabs/);
assert.match(research, /sidebar as the navigation hub/);
assert.match(research, /infinite-canvas surface/);
for (const url of [
  "https://primer.github.io/design/",
  "https://primer.style/foundations/layout",
  "https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests",
  "https://github.com/features/code-review",
  "https://www.notion.com/en-gb/help/guides/navigating-with-the-sidebar",
  "https://www.notion.com/en-gb/releases/2026-03-26",
  "https://www.goodnotes.com/tools/whiteboard",
  "https://support.goodnotes.com/hc/en-us/articles/13693350308751-Whiteboard",
  "https://linear.app/changelog/2026-03-12-ui-refresh"
]) {
  assert.match(research, new RegExp(escapeRegex(url)), `research must cite ${url}`);
}
assert.match(read("scripts/runtime-smoke.mjs"), /desktop/);
assert.match(read("scripts/runtime-smoke.mjs"), /mobile/);
assert.match(read("scripts/runtime-smoke.mjs"), /assertPng/);
assert.match(read("scripts/runtime-smoke.mjs"), /runChromeDom/);
assert.match(read("scripts/runtime-smoke.mjs"), /Acceptance loop/);
assert.match(read("scripts/runtime-smoke.mjs"), /Verification commands/);
const codexOnlySmoke = read("scripts/codex-only-smoke.mjs");
assert.match(codexOnlySmoke, /build-plugin-package\.mjs/);
assert.match(codexOnlySmoke, /build-standalone\.mjs/);
assert.match(codexOnlySmoke, /CODEX_SWARM_RELEASE_DIR/);
assert.match(codexOnlySmoke, /start-monitor\.sh/);
assert.match(codexOnlySmoke, /apps\/backend\/src\/index\.mjs/);
assert.match(codexOnlySmoke, /package\.json/);
assert.match(codexOnlySmoke, /codex-only packaged plugin smoke ok/);
assert.match(read("apps/ui/app.js"), /e2e_snapshot/);
assert.match(read("scripts/runtime-smoke.mjs"), /stream-status-card live/);
assert.match(read("scripts/runtime-smoke.mjs"), /just now ago/);
assert.match(read("scripts/runtime-smoke.mjs"), /Repository intelligence/);
assert.match(read("scripts/runtime-smoke.mjs"), /Ready for real Codex activity/);
assert.match(read("scripts/runtime-smoke.mjs"), /Event stream armed/);
assert.match(read("scripts/runtime-smoke.mjs"), /doesNotMatch\(renderedDom, \/No live agents yet\//);
assert.match(read("scripts/runtime-smoke.mjs"), /Event freshness/);
const avatarSmoke = read("scripts/avatar-smoke.mjs");
assert.match(avatarSmoke, /data-avatar-version="7"/);
assert.match(avatarSmoke, /notion-local-portrait/);
assert.match(avatarSmoke, /dicebear\|api\\\.dicebear/);
assert.match(avatarSmoke, /distinct deterministic portrait/);
assert.match(avatarSmoke, /avatar smoke ok/);
const realtimeSmoke = read("scripts/realtime-smoke.mjs");
assert.match(realtimeSmoke, /readSseUntil/);
assert.match(realtimeSmoke, /streamLatencyMs < 1000/);
assert.match(realtimeSmoke, /agent_spawn/);
assert.match(realtimeSmoke, /explorer-live01/);
assert.match(realtimeSmoke, /Inspect live workspace event flow/);
assert.match(realtimeSmoke, /state\?path=/);
assert.match(realtimeSmoke, /stream\?path=/);
assert.match(realtimeSmoke, /agent-card/);
assert.match(realtimeSmoke, /Event freshness/);
assert.match(realtimeSmoke, /v=7/);
assert.match(realtimeSmoke, /mockAgents\|demoAgents\|seedEvents\|api\\\.dicebear/);
assert.match(realtimeSmoke, /realtime smoke ok/);
const marketplaceScreenshot = read("scripts/refresh-marketplace-screenshot.mjs");
assert.match(marketplaceScreenshot, /dashboard-desktop\.png/);
assert.match(marketplaceScreenshot, /--connect/);
assert.match(marketplaceScreenshot, /DELETE/);
assert.match(marketplaceScreenshot, /state\?path=/);
assert.match(marketplaceScreenshot, /e2e_snapshot=1/);
assert.match(marketplaceScreenshot, /1440/);
assert.match(marketplaceScreenshot, /960/);
assert.match(marketplaceScreenshot, /No demo events/);
assert.match(marketplaceScreenshot, /Ready for real Codex activity/);
assert.match(marketplaceScreenshot, /Event stream armed/);
assert.match(marketplaceScreenshot, /Replay recovery/);
assert.match(marketplaceScreenshot, /Event freshness/);
assert.match(marketplaceScreenshot, /Local Notion-style avatars/);
assert.match(marketplaceScreenshot, /copyFileSync/);
assert.match(marketplaceScreenshot, /api\\\.dicebear\|dicebear/);
assert.match(marketplaceScreenshot, /Sisyphus\|Athena\|Hermes\|Hephaestus\|Argus\|Themis/);
const readiness = read("apps/backend/src/release-readiness.mjs");
assert.match(readiness, /git-remote/);
assert.match(readiness, /standalone-archives/);
assert.match(readiness, /All platform standalone archives built/);
assert.match(readiness, /plugin-package/);
assert.match(readiness, /Codex plugin release package built/);
assert.match(readiness, /plugin-release-source/);
assert.match(readiness, /pluginUrlsMatchRepo/);
assert.match(readiness, /sync-plugin-release-source/);
assert.match(readiness, /marketplace-submission/);
assert.match(readiness, /Codex marketplace submission bundle built/);
assert.match(readiness, /codex-marketplace-publication/);
assert.match(readiness, /Optional Codex plugin marketplace publication/);
assert.match(readiness, /publish-codex-marketplace/);
assert.match(readiness, /optional: true/);
assert.match(readiness, /CODEX_SWARM_MARKETPLACE_PUBLISHED/);
assert.match(readiness, /missing/);
assert.match(readiness, /published-release/);
assert.match(readiness, /published-release-assets/);
assert.match(readiness, /parseReleaseAssetNames/);
assert.match(readiness, /requiredReleaseAssets/);
assert.match(readiness, /listFiles/);
assert.match(readiness, /remediation/);
assert.match(readiness, /releasePlan/);
assert.match(readiness, /npm run verify/);
assert.match(readiness, /npm run marketplace:submission/);
assert.match(readiness, /npm run standalone:build:all/);
assert.match(readiness, /gh run download --dir dist/);
assert.doesNotMatch(readiness, /--name release-artifacts/);
assert.match(readiness, /gh release create/);
assert.match(readiness, /releaseCreateCommand/);
assert.match(readiness, /find dist -maxdepth 1 -type f/);
assert.match(readiness, /gh release upload \${tag}/);
assert.match(readiness, /--clobber/);
assert.doesNotMatch(readiness, /gh release create \$\{tag\} dist\/\*/);
assert.match(readiness, /Release checklist/);
assert.match(read("apps/backend/src/server.mjs"), /\/release\/readiness/);
assert.match(read("apps/backend/src/server.mjs"), /\/support\/bundle/);
assert.match(read("apps/backend/src/support-bundle.mjs"), /syntheticEvents: false/);
assert.match(read("apps/backend/src/index.mjs"), /--support/);
assert.match(read("apps/ui/app.js"), /releaseBlockers/);
assert.match(read("apps/ui/app.js"), /Release checklist/);
assert.match(read("apps/ui/app.js"), /downloadSupportBundle/);
assert.match(read("scripts/release-readiness.mjs"), /--strict/);
assert.match(read("scripts/verify-release-artifacts.mjs"), /codex-swarm-monitor-linux-x64/);
assert.match(read("scripts/verify-release-artifacts.mjs"), /codex-swarm-monitor-win32-x64/);
assert.match(read("scripts/verify-release-artifacts.mjs"), /requiredPluginFiles/);
assert.match(read("scripts/verify-release-artifacts.mjs"), /requiredMarketplaceSubmissionFiles/);
assert.match(read("scripts/verify-release-artifacts.mjs"), /standaloneOnly/);
const codexPluginInstallSmoke = read("scripts/codex-plugin-install-smoke.mjs");
assert.match(codexPluginInstallSmoke, /CODEX_HOME/);
assert.match(codexPluginInstallSmoke, /plugin", "marketplace", "add"/);
assert.match(codexPluginInstallSmoke, /plugin", "add", selector/);
assert.match(codexPluginInstallSmoke, /CODEX_SWARM_REQUIRE_CODEX_PLUGIN_SMOKE/);

const releaseRunbook = read("docs/release.md");
assert.match(releaseRunbook, /Codex only/);
assert.match(releaseRunbook, /npm run verify/);
assert.match(releaseRunbook, /npm run screenshot:marketplace/);
assert.match(releaseRunbook, /npm run release:readiness/);
assert.match(releaseRunbook, /npm run codex-only:smoke/);
assert.match(releaseRunbook, /gh run download --dir dist/);
assert.match(releaseRunbook, /npm run plugin:package/);
assert.match(releaseRunbook, /npm run marketplace:submission/);
assert.match(releaseRunbook, /CODEX_SWARM_REQUIRE_CODEX_PLUGIN_SMOKE=1 npm run codex-plugin:smoke/);
assert.match(releaseRunbook, /npm run release:artifacts -- dist/);
assert.match(releaseRunbook, /find dist -maxdepth 1 -type f/);
assert.match(releaseRunbook, /gh release upload v0\.1\.0 "\$\{release_assets\[@\]\}" --clobber/);
assert.match(releaseRunbook, /npm run release:remote-smoke/);
assert.match(releaseRunbook, /codex plugin add codex-swarm-monitor@codex-swarm-monitor/);
assert.match(releaseRunbook, /CODEX_SWARM_MARKETPLACE_PUBLISHED=1 npm run release:readiness/);
assert.match(releaseRunbook, /Last-Event-ID/);
assert.match(releaseRunbook, /remote avatar providers/);
assert.doesNotMatch(releaseRunbook, /swarm-ui-mockup|seed dashboard|DiceBear/i);

const privacy = read("docs/privacy.md");
assert.match(privacy, /local-first/);
assert.match(privacy, /local SQLite database/);
assert.match(privacy, /does not send workspace activity to a hosted service/);
assert.match(privacy, /Secrets are redacted|redacted before persistence/i);
assert.match(privacy, /remote avatar requests/);
assert.match(privacy, /demo or seed events/);
assert.match(privacy, /LiteLLM\/OpenInference.*outside the current default product boundary/);

const marketplaceNotes = read("plugins/codex-swarm-monitor/MARKETPLACE.md");
assert.match(marketplaceNotes, /Codex Swarm Monitor Marketplace Submission/);
assert.match(marketplaceNotes, /Codex only/);
assert.match(marketplaceNotes, /CODEX_SWARM_REQUIRE_CODEX_PLUGIN_SMOKE=1 npm run codex-plugin:smoke/);
assert.match(marketplaceNotes, /No hosted service/);
assert.match(marketplaceNotes, /No telemetry/);
assert.match(marketplaceNotes, /No remote avatar provider/);
assert.match(marketplaceNotes, /Last-Event-ID/);
assert.match(marketplaceNotes, /No Node\/npm\/source checkout/);
assert.doesNotMatch(marketplaceNotes, /swarm-ui-mockup|seed dashboard|DiceBear/i);
assert.match(read("scripts/verify-release-artifacts.mjs"), /inputDirs/);
assert.match(read("scripts/verify-release-artifacts.mjs"), /release artifact set is incomplete/);
assert.match(workflow, /Verify complete release artifact set/);
assert.match(workflow, /verify-release-artifacts\.mjs release-artifacts --standalone-only/);
assert.match(workflow, /Verify complete release asset set/);
assert.match(workflow, /verify-release-artifacts\.mjs release-artifacts dist/);
assert.match(workflow, /Checkout release sources/);
assert.match(workflow, /Setup Node for release publishing/);
assert.match(workflow, /Install release tooling/);
assert.match(workflow, /npm ci/);
assert.match(workflow, /Build Codex plugin package/);
assert.match(workflow, /plugin:package:smoke/);
assert.match(workflow, /Build Codex marketplace submission/);
assert.match(workflow, /marketplace:submission:smoke/);
assert.match(workflow, /Generate plugin package provenance attestation/);
assert.match(workflow, /mapfile -t release_assets/);
assert.match(workflow, /-name '\*\.tar\.gz'/);
assert.match(workflow, /-name '\*\.tar\.gz\.sha256'/);
assert.doesNotMatch(workflow, /find dist -maxdepth 2/);
assert.match(workflow, /dist\/codex-swarm-monitor-plugin-\*\.tar\.gz\.sha256/);
assert.match(workflow, /codex-swarm-monitor-plugin-\*\.tar\.gz/);
assert.match(workflow, /codex-swarm-monitor-marketplace-submission-\*\.tar\.gz/);
assert.match(workflow, /standalone runtime and Codex plugin package release/);
assert.match(read("scripts/build-plugin-package.mjs"), /dashboard-desktop\.png/);
assert.match(read("scripts/build-plugin-package.mjs"), /cpSync/);
assert.match(read("scripts/build-plugin-package.mjs"), /packageMarketplace/);
assert.match(read("scripts/build-plugin-package.mjs"), /path: "\.\/codex-swarm-monitor"/);
assert.doesNotMatch(read("scripts/build-plugin-package.mjs"), /execFileSync\("cp"/, "plugin package builder must not depend on Unix cp");
assert.match(read("scripts/plugin-package-smoke.mjs"), /readUInt32BE\(0\)/);
assert.match(read("scripts/plugin-package-smoke.mjs"), /source\.path/);
const marketplaceSubmissionBuilder = read("scripts/build-marketplace-submission.mjs");
assert.match(marketplaceSubmissionBuilder, /submission\.json/);
assert.match(marketplaceSubmissionBuilder, /release-assets\.json/);
assert.match(marketplaceSubmissionBuilder, /No demo or seed events/);
assert.match(marketplaceSubmissionBuilder, /CODEX_SWARM_REQUIRE_CODEX_PLUGIN_SMOKE=1 npm run codex-plugin:smoke/);
assert.match(marketplaceSubmissionBuilder, /codex plugin add codex-swarm-monitor@codex-swarm-monitor/);
assert.match(marketplaceSubmissionBuilder, /dashboard-desktop\.png/);
const marketplaceSubmissionSmoke = read("scripts/marketplace-submission-smoke.mjs");
assert.match(marketplaceSubmissionSmoke, /do not install Node, npm, Bun, OMX/);
assert.match(marketplaceSubmissionSmoke, /codex-plugin:smoke/);
assert.match(marketplaceSubmissionSmoke, /releaseAssets\.length, 10/);
assert.match(marketplaceSubmissionSmoke, /doesNotMatch\(submissionMarkdown, \/DiceBear/);
assert.match(read("scripts/plugin-smoke.mjs"), /assertStartScriptReinstallsMismatchedLauncher/);
assert.match(read("scripts/plugin-smoke.mjs"), /assertShellStartScriptReinstallsMismatchedLauncher/);
assert.match(read("package.json"), /plugin:package:smoke/);

const setup = read("docs/setup.md");
assert.match(setup, /End users should not need Node, npm, OMX, Bun/);
assert.match(setup, /release publication issue/);
assert.match(setup, /0` agents and `0` events/);
assert.match(setup, /Primary Codex plugin path/);
assert.match(setup, /Fallback direct standalone path/);
assert.match(setup, /Developer-only local source workflow/);
assert.ok(
  setup.indexOf("Primary Codex plugin path") < setup.indexOf("Fallback direct standalone path"),
  "setup docs must present the Codex plugin before the standalone fallback"
);
assert.ok(
  setup.indexOf("Developer-only local source workflow") < setup.indexOf("For npm package verification only"),
  "npm/npx path must stay in verification-only setup docs"
);
assert.match(setup, /For npm package verification only/);
assert.match(setup, /--connect --open/);

const ralph = read("RALPH.md");
assert.match(ralph, /--workspace <path> --connect --open/);
assert.match(ralph, /macOS x64/);

const plugin = readJson("plugins/codex-swarm-monitor/.codex-plugin/plugin.json");
assert.equal(plugin.name, "codex-swarm-monitor");
assert.equal(plugin.skills, "./skills/");
assert.equal(plugin.interface.screenshots[0], "./assets/screenshots/dashboard-desktop.png");
assert.equal(existsSync(join(root, "plugins/codex-swarm-monitor/assets/screenshots/dashboard-desktop.png")), true);
assert.equal(existsSync(join(root, "plugins/codex-swarm-monitor/scripts/install-standalone.sh")), true);
assert.equal(existsSync(join(root, "plugins/codex-swarm-monitor/scripts/install-standalone.ps1")), true);
assert.equal(existsSync(join(root, "plugins/codex-swarm-monitor/scripts/start-monitor.sh")), true);
assert.equal(existsSync(join(root, "plugins/codex-swarm-monitor/scripts/start-monitor.ps1")), true);
assert.match(read("plugins/codex-swarm-monitor/scripts/install-standalone.sh"), /CODEX_SWARM_RELEASE_VERSION/);
assert.match(read("plugins/codex-swarm-monitor/scripts/install-standalone.sh"), /releases\/download\/\$RELEASE_VERSION/);
assert.match(read("plugins/codex-swarm-monitor/scripts/install-standalone.ps1"), /CODEX_SWARM_RELEASE_VERSION/);
assert.match(read("plugins/codex-swarm-monitor/scripts/install-standalone.ps1"), /releases\/download\/\$releaseVersion/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.mjs"), /installStandalone/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.mjs"), /CODEX_SWARM_ALLOW_NPX/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.mjs"), /launcherVersionOk/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.mjs"), /\.codex-plugin\/plugin\.json/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.mjs"), /hasOption\("--workspace", "-w"\)/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.mjs"), /forwarded\.push\("--connect"\)/);
const monitorSkill = read("plugins/codex-swarm-monitor/skills/codex-swarm-monitor/SKILL.md");
assert.match(monitorSkill, /--connect --open/);
assert.match(monitorSkill, /Codex-Only User Promise/);
assert.match(monitorSkill, /Codex is the only prerequisite/);
assert.match(monitorSkill, /publication problem, not a user setup problem/);
assert.match(monitorSkill, /0` agents and `0` events/);
assert.match(monitorSkill, /Developer Source Checkout/);
assert.match(monitorSkill, /Do not present it as an end-user path/);
assert.ok(
  monitorSkill.indexOf("Start The Monitor") < monitorSkill.indexOf("Developer Source Checkout"),
  "plugin skill must keep source-checkout Node commands out of the end-user start path"
);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.sh"), /install-standalone\.sh/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.sh"), /DEFAULT_LAUNCHER/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.sh"), /HAS_CONNECT/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.sh"), /HAS_EXIT_ONLY/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.sh"), /REQUIRED_VERSION/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.sh"), /launcher_version_matches/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.sh"), /--version/);
assert.doesNotMatch(read("plugins/codex-swarm-monitor/scripts/start-monitor.sh"), /\bnode\b|\bnpx\b/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.ps1"), /install-standalone\.ps1/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.ps1"), /hasConnect/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.ps1"), /hasExitOnly/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.ps1"), /requiredVersion/);
assert.match(read("plugins/codex-swarm-monitor/scripts/start-monitor.ps1"), /--version/);
assert.doesNotMatch(read("plugins/codex-swarm-monitor/scripts/start-monitor.ps1"), /\bnpx\b/);

for (const path of [
  "apps/ui/app.js",
  "apps/ui/index.html",
  "apps/backend/src/server.mjs",
  "apps/backend/src/store.mjs",
  "apps/backend/src/workspace.mjs"
]) {
  const source = read(path);
  assert.doesNotMatch(source, /swarm-ui-mockup|ralph-hierarchy|mockAgents|demoAgents|seedEvents|loadDemo/i, `${path} must not contain demo event loaders`);
  assert.doesNotMatch(source, /api\.dicebear|dicebear/i, `${path} must not depend on remote avatar providers`);
}

assert.equal(existsSync(join(root, "plugins/codex-swarm-monitor/skills/codex-swarm-monitor/SKILL.md")), true);
console.log("release audit ok");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
