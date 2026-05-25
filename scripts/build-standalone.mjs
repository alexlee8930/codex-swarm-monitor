#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));
const platform = args.targetPlatform;
const arch = args.targetArch;
const target = `${platform}-${arch}`;
const distRoot = join(root, "dist");
const bundleRoot = join(distRoot, `codex-swarm-monitor-${target}`);
const appRoot = join(bundleRoot, "app");
const runtimeRoot = join(bundleRoot, "runtime");
const binRoot = join(bundleRoot, "bin");
const nodeBinaryName = platform === "win32" ? "node.exe" : "node";
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const releaseBuildLock = acquireBuildLock(join(distRoot, `.${basename(bundleRoot)}.lock`));
const nodeRuntime = args.nodeRuntime || process.execPath;

try {
  robustRm(bundleRoot);
  mkdirSync(appRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(binRoot, { recursive: true });

  for (const path of ["apps", "scripts", "tools", "plugins", ".agents", "README.md", "RALPH.md", "LICENSE", "marketplace.json", "package.json"]) {
    copy(path);
  }

  cpSync(nodeRuntime, join(runtimeRoot, nodeBinaryName));
  if (platform !== "win32") {
    execFileSync("chmod", ["755", join(runtimeRoot, nodeBinaryName)]);
  }

  writeLauncher();
  writeInstaller();
  writeReadme();

  const manifest = {
    name: "codex-swarm-monitor",
    version: packageJson.version,
    target,
    node: process.version,
    bundle: basename(bundleRoot),
    archive: `dist/${basename(bundleRoot)}.tar.gz`,
    checksumFile: `dist/${basename(bundleRoot)}.tar.gz.sha256`,
    entrypoint: platform === "win32" ? "bin/codex-swarm-monitor.cmd" : "bin/codex-swarm-monitor",
    buildInfo: "app/build-info.json"
  };
  writeFileSync(
    join(appRoot, "build-info.json"),
    `${JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        target: manifest.target,
        node: manifest.node,
        entrypoint: manifest.entrypoint,
        bundle: manifest.bundle
      },
      null,
      2
    )}\n`
  );
  writeFileSync(join(bundleRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const archive = createArchive();
  let checksum = null;
  if (archive) {
    checksum = createChecksum(join(root, archive));
    writeFileSync(join(root, `${archive}.sha256`), `${checksum}  ${basename(archive)}\n`);
  }

  assert.equal(existsSync(join(appRoot, "apps/backend/src/index.mjs")), true);
  assert.equal(existsSync(join(runtimeRoot, nodeBinaryName)), true);
  assert.equal(existsSync(join(bundleRoot, manifest.entrypoint)), true);
  console.log(JSON.stringify({ ...manifest, checksum }, null, 2));
} finally {
  releaseBuildLock();
}

function acquireBuildLock(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath);
      return () => robustRm(lockPath);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - started > 60000) {
        throw new Error(`Timed out waiting for standalone build lock: ${lockPath}`);
      }
      sleepSync(100);
    }
  }
}

function robustRm(path) {
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function copy(path) {
  const source = join(root, path);
  if (!existsSync(source)) return;
  cpSync(source, join(appRoot, path), { recursive: true, dereference: true });
}

function parseArgs(argv) {
  const options = {
    targetPlatform: process.platform,
    targetArch: process.arch,
    nodeRuntime: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      applyTarget(options, argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--target=")) {
      applyTarget(options, arg.slice("--target=".length));
    } else if (arg === "--node-runtime") {
      options.nodeRuntime = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--node-runtime=")) {
      options.nodeRuntime = arg.slice("--node-runtime=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!["darwin", "linux", "win32"].includes(options.targetPlatform)) {
    throw new Error(`Unsupported standalone platform: ${options.targetPlatform}`);
  }
  if (!["arm64", "x64"].includes(options.targetArch)) {
    throw new Error(`Unsupported standalone arch: ${options.targetArch}`);
  }
  if (options.targetPlatform === "win32" && options.targetArch !== "x64") {
    throw new Error("Windows standalone builds currently support x64 only");
  }
  if (options.nodeRuntime && !existsSync(options.nodeRuntime)) {
    throw new Error(`Node runtime not found: ${options.nodeRuntime}`);
  }
  return options;
}

function applyTarget(options, targetValue) {
  const match = String(targetValue || "").match(/^(darwin|linux|win32)-(arm64|x64)$/);
  if (!match) throw new Error(`Invalid --target value: ${targetValue}`);
  options.targetPlatform = match[1];
  options.targetArch = match[2];
}

function writeLauncher() {
  if (platform === "win32") {
    writeFileSync(
      join(binRoot, "codex-swarm-monitor.cmd"),
      `@echo off\r\nset SCRIPT_DIR=%~dp0\r\n"%SCRIPT_DIR%..\\runtime\\node.exe" "%SCRIPT_DIR%..\\app\\apps\\backend\\src\\index.mjs" %*\r\n`
    );
    return;
  }

  const launcher = join(binRoot, "codex-swarm-monitor");
  writeFileSync(
    launcher,
    `#!/usr/bin/env sh
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/../runtime/node" "$DIR/../app/apps/backend/src/index.mjs" "$@"
`
  );
  execFileSync("chmod", ["755", launcher]);
}

function writeInstaller() {
  if (platform === "win32") {
    const ps1 = [
      '$ErrorActionPreference = "Stop"',
      "$bundle = Split-Path -Parent $MyInvocation.MyCommand.Path",
      '$installRoot = if ($env:PREFIX) { $env:PREFIX } else { Join-Path $env:LOCALAPPDATA "CodexSwarmMonitor" }',
      '$binRoot = Join-Path $installRoot "bin"',
      '$appRoot = Join-Path $installRoot "app"',
      'New-Item -ItemType Directory -Force -Path $binRoot | Out-Null',
      'if (Test-Path $appRoot) { Remove-Item -Recurse -Force $appRoot }',
      'New-Item -ItemType Directory -Force -Path $appRoot | Out-Null',
      'Copy-Item -Recurse -Force (Join-Path $bundle "app") (Join-Path $appRoot "app")',
      'Copy-Item -Recurse -Force (Join-Path $bundle "runtime") (Join-Path $appRoot "runtime")',
      '$target = Join-Path $binRoot "codex-swarm-monitor.cmd"',
      '$node = Join-Path $appRoot "runtime\\node.exe"',
      '$entry = Join-Path $appRoot "app\\apps\\backend\\src\\index.mjs"',
      'Set-Content -Path $target -Value ("@echo off" + [Environment]::NewLine + "`"" + $node + "`" `"" + $entry + "`" %*" + [Environment]::NewLine)',
      'Write-Host "Installed codex-swarm-monitor launcher to $binRoot"',
      'Write-Host "Run: $binRoot\\codex-swarm-monitor.cmd --workspace C:\\path\\to\\codex-project --connect --open"'
    ].join("\n");
    writeFileSync(join(bundleRoot, "install.ps1"), `${ps1}\n`);
    return;
  }

  const installer = join(bundleRoot, "install.sh");
  writeFileSync(
    installer,
    `#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PREFIX="\${PREFIX:-$HOME/.local}"
mkdir -p "$PREFIX/bin"
APP_ROOT="$PREFIX/lib/codex-swarm-monitor"
rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT"
cp -R "$DIR/app" "$APP_ROOT/app"
cp -R "$DIR/runtime" "$APP_ROOT/runtime"
cat > "$PREFIX/bin/codex-swarm-monitor" <<EOF
#!/usr/bin/env sh
exec "$APP_ROOT/runtime/node" "$APP_ROOT/app/apps/backend/src/index.mjs" "\\$@"
EOF
chmod 755 "$PREFIX/bin/codex-swarm-monitor"
echo "Installed codex-swarm-monitor launcher to $PREFIX/bin/codex-swarm-monitor"
echo "Run: codex-swarm-monitor --workspace /path/to/codex-project --connect --open"
`
  );
  execFileSync("chmod", ["755", installer]);
}

function writeReadme() {
  writeFileSync(
    join(bundleRoot, "README-STANDALONE.md"),
    `# Codex Swarm Monitor Standalone Bundle

This bundle includes its own Node runtime. Users do not need to install Node or npm.

Run:

\`\`\`bash
./bin/codex-swarm-monitor --version
./bin/codex-swarm-monitor --workspace /path/to/codex-project --connect --open
./bin/codex-swarm-monitor --workspace /path/to/codex-project --doctor
./bin/codex-swarm-monitor --workspace /path/to/codex-project --support > codex-swarm-support.json
\`\`\`

Optional local install:

\`\`\`bash
./install.sh
codex-swarm-monitor --workspace /path/to/codex-project --connect --open
codex-swarm-monitor --workspace /path/to/codex-project --support > codex-swarm-support.json
\`\`\`

Then open the printed local URL, confirm Hook Trust shows \`7/7 lifecycle hooks configured\`, and run Codex from that same folder.

Build metadata is available in \`manifest.json\`, \`app/build-info.json\`, and \`GET /version\` while the monitor is running. The support bundle is local JSON only; it includes workspace analysis, doctor checks, release readiness, and recent redacted event summaries without creating synthetic events.
`
  );
}

function createArchive() {
  const archivePath = join(distRoot, `${basename(bundleRoot)}.tar.gz`);
  robustRm(archivePath);
  try {
    execFileSync("tar", ["-czf", archivePath, "-C", distRoot, basename(bundleRoot)], { stdio: "pipe" });
  } catch {
    return null;
  }
  assert.ok(statSync(archivePath).size > 1000000, "standalone archive should include the Node runtime");
  return relative(root, archivePath);
}

function createChecksum(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
