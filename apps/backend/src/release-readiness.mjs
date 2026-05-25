import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const COMMAND_TIMEOUT_MS = 5000;

export function releaseReadiness(packageRoot = PACKAGE_ROOT, options = {}) {
  const inspectPublished = options.inspectPublished !== false;
  const packageJson = readJson(packageRoot, "package.json");
  const versionTag = `v${packageJson.version}`;
  const requiredArchives = [
    "codex-swarm-monitor-linux-x64.tar.gz",
    "codex-swarm-monitor-darwin-arm64.tar.gz",
    "codex-swarm-monitor-darwin-x64.tar.gz",
    "codex-swarm-monitor-win32-x64.tar.gz"
  ];
  const requiredDesktopApps = [
    "codex-swarm-monitor-darwin-arm64.app.tar.gz",
    "codex-swarm-monitor-darwin-x64.app.tar.gz"
  ];
  const requiredChecksums = requiredArchives.map((name) => `${name}.sha256`);
  const requiredDesktopAppChecksums = requiredDesktopApps.map((name) => `${name}.sha256`);
  const optionalPluginArtifacts = [
    `codex-swarm-monitor-plugin-${packageJson.version}.tar.gz`,
    `codex-swarm-monitor-plugin-${packageJson.version}.tar.gz.sha256`
  ];
  const optionalMarketplaceSubmission = [
    `codex-swarm-monitor-marketplace-submission-${packageJson.version}.tar.gz`,
    `codex-swarm-monitor-marketplace-submission-${packageJson.version}.tar.gz.sha256`
  ];
  const requiredReleaseAssets = [
    ...requiredArchives,
    ...requiredChecksums,
    ...requiredDesktopApps,
    ...requiredDesktopAppChecksums
  ];
  const originRemote = git(packageRoot, ["remote", "get-url", "origin"]);
  const pluginManifest = readPluginManifest(packageRoot);
  const pluginRepository = pluginManifest?.repository || "";
  const originRepo = originRemote ? githubRepo(originRemote) : "";
  const pluginRepo = pluginRepository ? githubRepo(pluginRepository) : "";
  const pluginReleaseSourceOk = Boolean(originRepo && pluginRepo && originRepo === pluginRepo && pluginUrlsMatchRepo(pluginManifest, originRepo));

  const checks = [
    check("git-remote", "Public Git remote configured", Boolean(originRemote), {
      remediation: "Create a public GitHub repository and run: git remote add origin <repo-url>"
    }),
    check("version-tag", `Current commit has ${versionTag} tag`, git(packageRoot, ["tag", "--points-at", "HEAD"]).split(/\r?\n/).includes(versionTag), {
      remediation: `Commit the release source, then run: git tag ${versionTag} && git push origin HEAD ${versionTag}`
    }),
    check("release-workflow", "GitHub release workflow present", existsSync(join(packageRoot, ".github/workflows/release.yml")), {
      remediation: "Restore .github/workflows/release.yml before publishing release artifacts."
    }),
    checkArtifacts(packageRoot, "standalone-archives", "All platform standalone archives built", requiredArchives, {
      remediation: `Run npm run standalone:build:all locally, or build all release targets in GitHub Actions by pushing ${versionTag}, then run: gh run download --dir dist`
    }),
    checkArtifacts(packageRoot, "standalone-checksums", "All platform standalone checksums built", requiredChecksums, {
      remediation: "Generate and publish matching .sha256 files for every standalone archive."
    }),
    checkArtifacts(packageRoot, "desktop-apps", "macOS app wrapper archives built", requiredDesktopApps, {
      remediation: "Run npm run desktop:smoke on macOS, or npm run standalone:build:all to build the macOS .app archives."
    }),
    checkArtifacts(packageRoot, "desktop-app-checksums", "macOS app wrapper checksums built", requiredDesktopAppChecksums, {
      remediation: "Generate and publish matching .sha256 files for every macOS .app archive."
    }),
    checkArtifacts(packageRoot, "plugin-package", "Optional Codex plugin release package built", optionalPluginArtifacts, {
      optional: true,
      remediation: "Optional distribution path only. Run npm run plugin:package before publishing a Codex plugin package."
    }),
    checkArtifacts(packageRoot, "marketplace-submission", "Optional Codex marketplace submission bundle built", optionalMarketplaceSubmission, {
      optional: true,
      remediation: "Optional distribution path only. Run npm run marketplace:submission before submitting the Codex plugin to a marketplace."
    }),
    check("marketplace-local", "Local Codex marketplace manifest present", existsSync(join(packageRoot, ".agents/plugins/marketplace.json")), {
      optional: true,
      remediation: "Restore .agents/plugins/marketplace.json so Codex can discover the plugin locally."
    }),
    check("plugin-manifest", "Codex plugin manifest present", existsSync(join(packageRoot, "plugins/codex-swarm-monitor/.codex-plugin/plugin.json")), {
      optional: true,
      remediation: "Restore plugins/codex-swarm-monitor/.codex-plugin/plugin.json before packaging the plugin."
    }),
    check("plugin-release-source", "Optional Codex plugin release source matches Git origin", pluginReleaseSourceOk, {
      optional: true,
      remediation: originRepo
        ? `Set plugins/codex-swarm-monitor/.codex-plugin/plugin.json repository/homepage/website URLs to https://github.com/${originRepo} before packaging.`
        : "Configure the public GitHub origin first; the plugin bootstrap release URL is derived from its repository metadata."
    }),
    check("codex-marketplace-publication", "Optional Codex plugin marketplace publication", marketplacePublished(options), {
      optional: true,
      remediation: "Optional distribution path only. If publishing the Codex plugin package to a Codex marketplace, verify `codex plugin add codex-swarm-monitor@codex-swarm-monitor`, then set CODEX_SWARM_MARKETPLACE_PUBLISHED=1 for release readiness."
    }),
    check("macos-signing-secrets", "macOS signing/notarization secrets available", envPresent([
      "MACOS_CERTIFICATE_P12_BASE64",
      "MACOS_CERTIFICATE_PASSWORD",
      "MACOS_CODESIGN_IDENTITY",
      "MACOS_NOTARY_APPLE_ID",
      "MACOS_NOTARY_TEAM_ID",
      "MACOS_NOTARY_PASSWORD"
    ]), {
      optional: true,
      remediation: "Add macOS signing and notarization secrets in GitHub Actions for a trusted public macOS release."
    }),
    check("windows-signing-secrets", "Windows Authenticode signing secrets available", envPresent([
      "WINDOWS_CERTIFICATE_PFX_BASE64",
      "WINDOWS_CERTIFICATE_PASSWORD"
    ]), {
      optional: true,
      remediation: "Add Windows Authenticode certificate secrets in GitHub Actions for a signed Windows release."
    }),
    check("github-cli", "GitHub CLI available for release inspection", Boolean(command(packageRoot, ["gh", "--version"])), {
      optional: true,
      remediation: "Install and authenticate GitHub CLI: gh auth login"
    }),
    check("published-release", `${versionTag} GitHub release visible`, inspectPublished && Boolean(githubRelease(packageRoot, versionTag)), {
      optional: true,
      remediation: `Create the release from the tag: ${releaseCreateCommand(versionTag)}`
    }),
    checkPublishedReleaseAssets(packageRoot, versionTag, requiredReleaseAssets, { inspectPublished })
  ];

  const blockers = checks.filter((item) => !item.ok && !item.optional);
  const warnings = checks.filter((item) => !item.ok && item.optional);

  return {
    ok: checks.every((item) => item.ok || item.optional),
    strictOk: checks.every((item) => item.ok),
    version: packageJson.version,
    tag: versionTag,
    checks,
    blockers,
    warnings,
    plan: releasePlan({ checks, version: packageJson.version, tag: versionTag })
  };
}

export function formatReleaseReadiness(summary) {
  const lines = [`Codex Swarm Monitor release readiness (${summary.tag})`];
  for (const item of summary.checks) {
    const mark = item.ok ? "ok" : item.optional ? "warn" : "fail";
    lines.push(`[${mark}] ${item.id}: ${item.summary}`);
    if (!item.ok && item.remediation) lines.push(`      ${item.remediation}`);
  }
  if (summary.plan?.length) {
    lines.push("");
    lines.push("Release checklist");
    for (const item of summary.plan) {
      lines.push(`[${item.state}] ${item.label}`);
      lines.push(`      ${item.command}`);
      lines.push(`      ${item.detail}`);
    }
  }
  return lines.join("\n");
}

function check(id, summary, ok, options = {}) {
  return {
    id,
    summary,
    ok: Boolean(ok),
    optional: options.optional === true,
    remediation: options.remediation
  };
}

function checkArtifacts(packageRoot, id, summary, filenames, options = {}) {
  const available = new Set(listFiles(join(packageRoot, "dist")).map((path) => basename(path)));
  const missing = filenames.filter((name) => !available.has(name));
  return {
    ...check(id, missing.length ? `${summary}; missing ${missing.join(", ")}` : summary, missing.length === 0, options),
    missing
  };
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function releasePlan({ checks, version, tag }) {
  const byId = new Map(checks.map((item) => [item.id, item]));
  const ok = (id) => byId.get(id)?.ok === true;
  return [
    {
      id: "verify-source",
      label: "Verify local product gate",
      command: "npm run verify",
      state: "ready",
      detail: "Runs tests, package/plugin smoke, fresh-machine smoke, runtime UI smoke, and MCP dry-run."
    },
    {
      id: "publish-source",
      label: "Publish release source",
      command: "git remote add origin <repo-url> && git push -u origin HEAD",
      state: ok("git-remote") ? "done" : "blocked",
      detail: ok("git-remote") ? "Origin remote is configured." : "Create a public repository first, then push this source."
    },
    {
      id: "sync-plugin-release-source",
      label: "Sync plugin release source",
      command: "npm run release:sync-source",
      state: ok("plugin-release-source") ? "done" : ok("git-remote") ? "ready" : "blocked",
      detail: ok("plugin-release-source")
        ? "Optional plugin bootstrap URLs match the GitHub origin."
        : "Optional plugin metadata can be synced when packaging a Codex plugin distribution."
    },
    {
      id: "create-tag",
      label: `Create ${tag} tag`,
      command: `git tag ${tag} && git push origin HEAD ${tag}`,
      state: ok("version-tag") ? "done" : ok("git-remote") ? "ready" : "blocked",
      detail: ok("version-tag") ? "Version tag is already on HEAD." : "The release workflow publishes artifacts from this tag."
    },
    {
      id: "collect-artifacts",
      label: "Collect platform artifacts",
      command: "npm run standalone:build:all",
      state: ok("standalone-archives") && ok("standalone-checksums") && ok("desktop-apps") && ok("desktop-app-checksums") ? "done" : ok("version-tag") ? "ready" : "blocked",
      detail: "Builds all platform bundles plus macOS app wrappers from official Node runtimes. GitHub workflow downloads are also accepted under dist/."
    },
    {
      id: "package-plugin",
      label: "Optional Codex plugin package",
      command: "npm run plugin:package",
      state: ok("plugin-package") ? "done" : "ready",
      detail: `Optional path. Creates codex-swarm-monitor-plugin-${version}.tar.gz and checksum.`
    },
    {
      id: "package-marketplace-submission",
      label: "Optional Codex marketplace submission",
      command: "npm run marketplace:submission",
      state: ok("marketplace-submission") ? "done" : "ready",
      detail: `Optional path. Creates codex-swarm-monitor-marketplace-submission-${version}.tar.gz with listing notes, screenshot, plugin archive, and asset manifest.`
    },
    {
      id: "verify-release-assets",
      label: "Verify release asset set",
      command: "npm run release:artifacts -- dist",
      state: ok("standalone-archives") && ok("standalone-checksums") && ok("desktop-apps") && ok("desktop-app-checksums") ? "ready" : "blocked",
      detail: "Confirms every required archive and checksum exists before publishing."
    },
    {
      id: "publish-github-release",
      label: "Publish GitHub release",
      command: releaseCreateCommand(tag),
      state: ok("standalone-archives") && ok("standalone-checksums") && ok("desktop-apps") && ok("desktop-app-checksums") ? "ready" : "blocked",
      detail: "Uploads standalone bundles, macOS app wrappers, and checksums. Optional Codex plugin artifacts may be uploaded when built."
    },
    {
      id: "publish-codex-marketplace",
      label: "Optional Codex marketplace plugin",
      command: "codex plugin add codex-swarm-monitor@codex-swarm-monitor",
      state: ok("codex-marketplace-publication") ? "done" : "ready",
      detail: ok("codex-marketplace-publication")
        ? "Codex marketplace publication has been externally verified."
        : "Optional path. The primary public distribution is the released app bundle and standalone archives."
    }
  ];
}

function releaseCreateCommand(tag) {
  return `gh release create ${tag} $(find dist -maxdepth 1 -type f \\( -name '*.tar.gz' -o -name '*.sha256' -o -name '*.zip' -o -name '*.zip.sha256' \\) -print) --title ${tag} || gh release upload ${tag} $(find dist -maxdepth 1 -type f \\( -name '*.tar.gz' -o -name '*.sha256' -o -name '*.zip' -o -name '*.zip.sha256' \\) -print) --clobber`;
}

function envPresent(names) {
  return names.every((name) => Boolean(process.env[name]));
}

function marketplacePublished(options) {
  return options.marketplacePublished === true || process.env.CODEX_SWARM_MARKETPLACE_PUBLISHED === "1";
}

function githubRelease(packageRoot, tag) {
  const remote = git(packageRoot, ["remote", "get-url", "origin"]);
  if (!remote || !command(packageRoot, ["gh", "--version"])) return "";
  return command(packageRoot, ["gh", "release", "view", tag, "--repo", githubRepo(remote), "--json", "tagName"]);
}

function checkPublishedReleaseAssets(packageRoot, tag, filenames, options = {}) {
  const remote = git(packageRoot, ["remote", "get-url", "origin"]);
  const raw = options.inspectPublished !== false && remote && command(packageRoot, ["gh", "--version"])
    ? command(packageRoot, ["gh", "release", "view", tag, "--repo", githubRepo(remote), "--json", "assets"])
    : "";
  const assets = parseReleaseAssetNames(raw);
  const missing = filenames.filter((name) => !assets.includes(name));
  return {
    ...check(
      "published-release-assets",
      missing.length ? `${tag} GitHub release assets incomplete; missing ${missing.join(", ")}` : `${tag} GitHub release assets complete`,
      Boolean(raw) && missing.length === 0,
      {
        optional: true,
        remediation: "Upload every app archive, standalone archive, and matching checksum to the GitHub release. Optional plugin artifacts can be uploaded when that distribution path is used."
      }
    ),
    missing
  };
}

function parseReleaseAssetNames(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return (parsed.assets || []).map((asset) => asset.name).filter(Boolean);
  } catch {
    return [];
  }
}

function githubRepo(remote) {
  return remote
    .replace(/^git@github\.com:/, "")
    .replace(/^ssh:\/\/git@github\.com\//, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^http:\/\/github\.com\//, "")
    .replace(/\/releases\/download\/.*$/, "")
    .replace(/\/blob\/.*$/, "")
    .replace(/\.git$/, "");
}

function git(packageRoot, args) {
  return command(packageRoot, ["git", ...args]);
}

function command(packageRoot, args) {
  try {
    return execFileSync(args[0], args.slice(1), {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: COMMAND_TIMEOUT_MS
    }).trim();
  } catch {
    return "";
  }
}

function readJson(packageRoot, path) {
  return JSON.parse(readFileSync(join(packageRoot, path), "utf8"));
}

function readPluginManifest(packageRoot) {
  const path = join(packageRoot, "plugins/codex-swarm-monitor/.codex-plugin/plugin.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function pluginUrlsMatchRepo(manifest, repo) {
  if (!manifest) return false;
  const base = `https://github.com/${repo}`;
  const urls = [
    manifest.repository,
    manifest.homepage,
    manifest.interface?.websiteURL,
    manifest.interface?.privacyPolicyURL,
    manifest.interface?.termsOfServiceURL
  ];
  return urls.every((url) => typeof url === "string" && url.startsWith(base));
}
