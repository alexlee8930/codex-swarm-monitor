#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const args = parseArgs(process.argv.slice(2));
const target = args.target;
const standaloneName = `codex-swarm-monitor-${target}`;
const distRoot = join(root, "dist");
const standaloneRoot = join(distRoot, standaloneName);
const stageRoot = join(distRoot, `desktop-app-${target}`);
const appBundle = join(stageRoot, "Codex Swarm Monitor.app");
const contentsRoot = join(appBundle, "Contents");
const macosRoot = join(contentsRoot, "MacOS");
const resourcesRoot = join(contentsRoot, "Resources");
const embeddedStandaloneRoot = join(resourcesRoot, standaloneName);

if (!target.startsWith("darwin-")) {
  throw new Error(`Desktop .app wrapper currently supports darwin targets only, received ${target}`);
}

if (args.buildStandalone || !existsSync(join(standaloneRoot, "manifest.json"))) {
  const buildArgs = ["scripts/build-standalone.mjs", "--target", target];
  if (args.nodeRuntime) buildArgs.push("--node-runtime", args.nodeRuntime);
  const manifest = JSON.parse(execFileSync(process.execPath, buildArgs, { cwd: root, encoding: "utf8" }));
  assert.equal(manifest.target, target);
}

const standaloneManifest = JSON.parse(readFileSync(join(standaloneRoot, "manifest.json"), "utf8"));
assert.equal(standaloneManifest.target, target);

rmSync(stageRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
mkdirSync(macosRoot, { recursive: true });
mkdirSync(resourcesRoot, { recursive: true });
cpSync(standaloneRoot, embeddedStandaloneRoot, { recursive: true, dereference: true });

writeInfoPlist();
writePkgInfo();
writeLauncher();
writeReadme();

const manifestBase = {
  name: "codex-swarm-monitor-desktop-app",
  version: packageJson.version,
  target,
  bundle: "Codex Swarm Monitor.app",
  stage: relative(root, appBundle),
  archive: relative(root, join(distRoot, `${standaloneName}.app.tar.gz`)),
  checksumFile: relative(root, join(distRoot, `${standaloneName}.app.tar.gz.sha256`)),
  embeddedStandalone: standaloneName,
  executable: "Contents/MacOS/Codex Swarm Monitor"
};
writeFileSync(join(resourcesRoot, "desktop-manifest.json"), `${JSON.stringify(manifestBase, null, 2)}\n`);

const archive = join(distRoot, `${standaloneName}.app.tar.gz`);
rmSync(archive, { force: true });
execFileSync("tar", ["-czf", archive, "-C", stageRoot, "Codex Swarm Monitor.app"], { stdio: "pipe" });
assert.ok(statSync(archive).size > 1_000_000, "desktop app archive should include the standalone runtime");
const checksum = sha256(archive);
writeFileSync(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`);

const manifest = {
  ...manifestBase,
  checksum
};

assert.equal(existsSync(join(appBundle, manifest.executable)), true);
assert.equal(existsSync(join(embeddedStandaloneRoot, standaloneManifest.entrypoint)), true);
assert.equal(existsSync(join(contentsRoot, "Info.plist")), true);
console.log(JSON.stringify(manifest, null, 2));

function parseArgs(argv) {
  const options = {
    target: `${process.platform}-${process.arch}`,
    nodeRuntime: "",
    buildStandalone: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      options.target = normalizeTarget(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--target=")) {
      options.target = normalizeTarget(arg.slice("--target=".length));
    } else if (arg === "--node-runtime") {
      options.nodeRuntime = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--node-runtime=")) {
      options.nodeRuntime = arg.slice("--node-runtime=".length);
    } else if (arg === "--build-standalone") {
      options.buildStandalone = true;
    } else if (arg === "--no-build-standalone") {
      options.buildStandalone = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!/^darwin-(arm64|x64)$/.test(options.target)) {
    throw new Error(`Invalid desktop app target: ${options.target}`);
  }
  if (options.nodeRuntime && !existsSync(options.nodeRuntime)) {
    throw new Error(`Node runtime not found: ${options.nodeRuntime}`);
  }
  return options;
}

function normalizeTarget(value) {
  return String(value || "").replace(/^codex-swarm-monitor-/, "");
}

function writeInfoPlist() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Codex Swarm Monitor</string>
  <key>CFBundleExecutable</key>
  <string>Codex Swarm Monitor</string>
  <key>CFBundleIdentifier</key>
  <string>com.codexswarm.monitor</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Codex Swarm Monitor</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${packageJson.version}</string>
  <key>CFBundleVersion</key>
  <string>${packageJson.version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSHumanReadableCopyright</key>
  <string>Copyright Codex Swarm Monitor contributors</string>
</dict>
</plist>
`;
  writeFileSync(join(contentsRoot, "Info.plist"), plist);
}

function writePkgInfo() {
  writeFileSync(join(contentsRoot, "PkgInfo"), "APPL????");
}

function writeLauncher() {
  const launcher = join(macosRoot, "Codex Swarm Monitor");
  writeFileSync(
    launcher,
    `#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RESOURCES="$DIR/../Resources"
APP_BIN="$RESOURCES/${standaloneName}/bin/codex-swarm-monitor"

if [ "$#" -gt 0 ]; then
  exec "$APP_BIN" "$@"
fi

LOG_DIR="$HOME/Library/Logs/Codex Swarm Monitor"
mkdir -p "$LOG_DIR"
exec "$APP_BIN" --workspace "$HOME" --open >> "$LOG_DIR/app.log" 2>&1
`
  );
  execFileSync("chmod", ["755", launcher]);
}

function writeReadme() {
  writeFileSync(
    join(resourcesRoot, "README-DESKTOP-APP.md"),
    `# Codex Swarm Monitor.app

Open \`Codex Swarm Monitor.app\` to start the bundled local monitor and open the browser UI.

The app embeds the standalone runtime under \`Contents/Resources/${standaloneName}\`.
It does not install hooks into \`$HOME\` automatically. Pick or connect the real Codex workspace from the UI, or run the embedded launcher with \`--workspace /path/to/project --connect --open\`.

Logs are written to \`~/Library/Logs/Codex Swarm Monitor/app.log\`.
`
  );
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
