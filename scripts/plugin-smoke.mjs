#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pluginRoot = join(root, "plugins/codex-swarm-monitor");
const plugin = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));
const marketplace = JSON.parse(readFileSync(join(root, "marketplace.json"), "utf8"));
const codexMarketplace = JSON.parse(readFileSync(join(root, ".agents/plugins/marketplace.json"), "utf8"));
const skill = readFileSync(join(pluginRoot, "skills/codex-swarm-monitor/SKILL.md"), "utf8");
const marketplaceNotes = readFileSync(join(pluginRoot, "MARKETPLACE.md"), "utf8");
const startScript = join(pluginRoot, "scripts/start-monitor.mjs");
const startScriptSource = readFileSync(startScript, "utf8");
const shellStartScript = join(pluginRoot, "scripts/start-monitor.sh");
const shellStartSource = readFileSync(shellStartScript, "utf8");
const windowsStartScript = join(pluginRoot, "scripts/start-monitor.ps1");
const windowsStartSource = readFileSync(windowsStartScript, "utf8");
const installScript = join(pluginRoot, "scripts/install-standalone.sh");
const windowsInstallScript = join(pluginRoot, "scripts/install-standalone.ps1");

assert.equal(plugin.name, "codex-swarm-monitor");
assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
assert.equal(plugin.license, "MIT");
assert.equal(plugin.skills, "./skills/");
assert.equal(plugin.interface.displayName, "Codex Swarm Monitor");
assert.equal(plugin.interface.category, "Coding");
assert.ok(Array.isArray(plugin.keywords) && plugin.keywords.includes("codex"));
assert.ok(plugin.interface.defaultPrompt.length <= 3);
assert.ok(plugin.interface.defaultPrompt.every((prompt) => prompt.length <= 128));
assert.equal(plugin.interface.screenshots.length, 1);
assert.equal(plugin.interface.screenshots[0].path, "./assets/screenshots/dashboard-desktop.png");
assert.match(plugin.interface.screenshots[0].label, /Ralph loop analysis/);
assert.match(plugin.interface.privacyPolicyURL, /docs\/privacy\.md/);
assert.match(plugin.interface.termsOfServiceURL, /LICENSE/);
assertPng(join(pluginRoot, plugin.interface.screenshots[0].path));
assert.equal(existsSync(startScript), true);
assert.equal(existsSync(shellStartScript), true);
assert.equal(existsSync(windowsStartScript), true);
assert.equal(existsSync(installScript), true);
assert.equal(existsSync(windowsInstallScript), true);
assert.equal(marketplace.plugins[0].name, plugin.name);
assert.equal(marketplace.plugins[0].source.path, "./plugins/codex-swarm-monitor");
assert.equal(marketplace.plugins[0].policy.installation, "AVAILABLE");
assert.equal(marketplace.plugins[0].policy.authentication, "ON_INSTALL");
assert.deepEqual(codexMarketplace, marketplace);
assert.match(execFileSync(process.execPath, [startScript, "--help"], { encoding: "utf8" }), /--workspace <path>/);
assertStartScriptForwardsWorkspaceEqualsForm(startScript);
assertStartScriptReinstallsMismatchedLauncher(startScript);
assert.match(skill, /codex-swarm-monitor --workspace "\$PWD" --connect --open/);
assert.match(skill, /start-monitor\.sh --workspace "\$PWD" --connect/);
assert.match(skill, /start-monitor\.ps1 --workspace "\$PWD" --connect/);
assert.match(skill, /plugins\/codex-swarm-monitor\/scripts\/install-standalone\.sh/);
assert.match(skill, /install-standalone\.ps1/);
assert.match(skill, /CODEX_SWARM_ALLOW_NPX=1/);
assert.match(skill, /CODEX_SWARM_RELEASE_VERSION/);
assert.match(skill, /npm run verify/);
assert.match(skill, /Action Contract/);
assert.match(skill, /do the work directly/);
assert.match(skill, /Keep the monitor process running/);
assert.match(skill, /Codex-Only User Promise/);
assert.match(skill, /Codex is the only prerequisite/);
assert.match(skill, /Do not ask them to install Node, npm, Bun, OMX, Python, or this source checkout/);
assert.match(skill, /fail with a release-operations error/);
assert.match(skill, /publication problem, not a user setup problem/);
assert.match(skill, /0` agents and `0` events/);
assert.match(skill, /swarm-ui-mockup\.html/);
assert.match(skill, /synthetic event generators/);
assert.match(skill, /\/release\/readiness/);
assert.match(skill, /plan.*checklist/s);
assert.match(skill, /--support > codex-swarm-support\.json/);
assert.match(marketplaceNotes, /Codex Swarm Monitor Marketplace Submission/);
assert.match(marketplaceNotes, /Codex only/);
assert.match(marketplaceNotes, /No hosted service/);
assert.match(marketplaceNotes, /No telemetry/);
assert.match(marketplaceNotes, /Last-Event-ID/);
assert.match(marketplaceNotes, /No Node\/npm\/source checkout/);
assert.doesNotMatch(marketplaceNotes, /DiceBear|seed dashboard|swarm-ui-mockup/i);
assert.match(startScriptSource, /installStandalone/);
assert.match(startScriptSource, /install-standalone\.sh/);
assert.match(startScriptSource, /install-standalone\.ps1/);
assert.match(startScriptSource, /CODEX_SWARM_ALLOW_NPX/);
assert.match(startScriptSource, /launcherVersionOk/);
assert.match(startScriptSource, /\.codex-plugin\/plugin\.json/);
assert.match(startScriptSource, /hasOption\("--workspace", "-w"\)/);
assert.match(startScriptSource, /forwarded\.push\("--connect"\)/);
assert.match(startScriptSource, /"--support"/);
assert.match(startScriptSource, /bootstrapFailureMessage/);
assert.match(startScriptSource, /pluginRepositoryUrl/);
assert.match(startScriptSource, /checked PATH plus/);
assert.match(shellStartSource, /install-standalone\.sh/);
assert.match(shellStartSource, /command -v codex-swarm-monitor/);
assert.match(shellStartSource, /DEFAULT_LAUNCHER/);
assert.match(shellStartSource, /HAS_CONNECT/);
assert.match(shellStartSource, /HAS_SUPPORT/);
assert.match(shellStartSource, /REQUIRED_VERSION/);
assert.match(shellStartSource, /launcher_version_matches/);
assert.match(shellStartSource, /--version/);
assert.match(shellStartSource, /set -- "\$@" --connect/);
assert.match(shellStartSource, /HAS_EXIT_ONLY/);
assert.match(shellStartSource, /bootstrap failed before a launcher was available/);
assert.match(shellStartSource, /checked PATH plus/);
assert.match(shellStartSource, /PLUGIN_REPOSITORY/);
assert.doesNotMatch(shellStartSource, /\bnode\b|\bnpx\b/);
assert.match(readFileSync(installScript, "utf8"), /CODEX_SWARM_RELEASE_VERSION/);
assert.match(readFileSync(installScript, "utf8"), /releases\/download\/\$RELEASE_VERSION/);
assert.match(readFileSync(installScript, "utf8"), /PLUGIN_REPOSITORY/);
assert.match(readFileSync(installScript, "utf8"), /standalone install failed/);
assert.match(readFileSync(installScript, "utf8"), /release archive not found/);
assert.match(windowsStartSource, /install-standalone\.ps1/);
assert.match(windowsStartSource, /Get-Command codex-swarm-monitor\.cmd/);
assert.match(windowsStartSource, /hasConnect/);
assert.match(windowsStartSource, /hasSupport/);
assert.match(windowsStartSource, /requiredVersion/);
assert.match(windowsStartSource, /--version/);
assert.match(windowsStartSource, /\$forwarded \+= "--connect"/);
assert.match(windowsStartSource, /hasExitOnly/);
assert.match(windowsStartSource, /bootstrap failed before a launcher was available/);
assert.match(windowsStartSource, /checked PATH plus/);
assert.match(windowsStartSource, /pluginRepository/);
assert.doesNotMatch(windowsStartSource, /\bnpx\b/);
assert.match(readFileSync(windowsInstallScript, "utf8"), /CODEX_SWARM_RELEASE_VERSION/);
assert.match(readFileSync(windowsInstallScript, "utf8"), /releases\/download\/\$releaseVersion/);
assert.match(readFileSync(windowsInstallScript, "utf8"), /pluginRepository/);
assert.match(readFileSync(windowsInstallScript, "utf8"), /standalone install failed/);
assert.match(readFileSync(windowsInstallScript, "utf8"), /release archive not found/);
assert.doesNotMatch(JSON.stringify(plugin), /\[TODO:/);
assert.doesNotMatch(skill, /\[TODO:/);
assertStartScriptDoesNotConnectSupport(startScript);
assertShellStartScriptReinstallsMismatchedLauncher(shellStartScript);

function assertPng(path) {
  assert.equal(existsSync(path), true);
  assert.ok(statSync(path).size > 100000, "marketplace screenshot should be a real UI capture");
  const file = readFileSync(path);
  assert.equal(file.readUInt32BE(0), 0x89504e47);
  assert.equal(file.readUInt32BE(16), 1440);
  assert.equal(file.readUInt32BE(20), 960);
}

function assertStartScriptDoesNotConnectSupport(startScript) {
  if (process.platform === "win32") return;
  const temp = mkdtempSync(join(tmpdir(), "codex-swarm-plugin-support-"));
  try {
    const scriptsDir = join(temp, "scripts");
    const binDir = join(temp, "bin");
    const workspace = join(temp, "workspace");
    const capture = join(temp, "capture.txt");
    execFileSync("mkdir", ["-p", scriptsDir, binDir, workspace]);
    cpSync(startScript, join(scriptsDir, "start-monitor.mjs"));
    const fakeLauncher = join(binDir, "codex-swarm-monitor");
    writeFileSync(
      fakeLauncher,
      `#!/usr/bin/env sh
{
  printf 'cwd=%s\\n' "$PWD"
  printf 'args=%s\\n' "$*"
} > "$CODEX_SWARM_CAPTURE"
`
    );
    chmodSync(fakeLauncher, 0o755);

    execFileSync(process.execPath, [join(scriptsDir, "start-monitor.mjs"), `--workspace=${workspace}`, "--support"], {
      cwd: temp,
      env: {
        ...process.env,
        CODEX_SWARM_CAPTURE: capture,
        PATH: `${binDir}:/usr/bin:/bin`
      },
      stdio: "pipe"
    });

    const output = readFileSync(capture, "utf8").trim();
    assert.match(output, /cwd=.*\/workspace/);
    assert.match(output, /args=--workspace=.*\/workspace --support$/);
    assert.doesNotMatch(output, /--connect|--open/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function assertStartScriptForwardsWorkspaceEqualsForm(startScript) {
  if (process.platform === "win32") return;
  const temp = mkdtempSync(join(tmpdir(), "codex-swarm-plugin-start-"));
  try {
    const scriptsDir = join(temp, "scripts");
    const binDir = join(temp, "bin");
    const workspace = join(temp, "workspace");
    const capture = join(temp, "capture.txt");
    execFileSync("mkdir", ["-p", scriptsDir, binDir, workspace]);
    cpSync(startScript, join(scriptsDir, "start-monitor.mjs"));
    const fakeLauncher = join(binDir, "codex-swarm-monitor");
    writeFileSync(
      fakeLauncher,
      `#!/usr/bin/env sh
{
  printf 'cwd=%s\\n' "$PWD"
  printf 'args=%s\\n' "$*"
} > "$CODEX_SWARM_CAPTURE"
`
    );
    chmodSync(fakeLauncher, 0o755);

    execFileSync(process.execPath, [join(scriptsDir, "start-monitor.mjs"), `--workspace=${workspace}`, "--port", "0"], {
      cwd: temp,
      env: {
        ...process.env,
        CODEX_SWARM_CAPTURE: capture,
        PATH: `${binDir}:/usr/bin:/bin`
      },
      stdio: "pipe"
    });

    const output = readFileSync(capture, "utf8");
    assert.doesNotMatch(output, /old shell launcher should not run/);
    assert.match(output, new RegExp(`args=--workspace=${escapeRegex(workspace)} --port 0 --connect --open`));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function assertStartScriptReinstallsMismatchedLauncher(startScript) {
  if (process.platform === "win32") return;
  const temp = mkdtempSync(join(tmpdir(), "codex-swarm-plugin-version-"));
  try {
    const scriptsDir = join(temp, "scripts");
    const pluginDir = join(temp, ".codex-plugin");
    const binDir = join(temp, "bin");
    const workspace = join(temp, "workspace");
    const capture = join(temp, "capture.txt");
    execFileSync("mkdir", ["-p", scriptsDir, pluginDir, binDir, workspace]);
    cpSync(startScript, join(scriptsDir, "start-monitor.mjs"));
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ version: "0.1.0" }));
    const fakeLauncher = join(binDir, "codex-swarm-monitor");
    writeFileSync(
      fakeLauncher,
      `#!/usr/bin/env sh
if [ "$1" = "--version" ]; then
  echo "codex-swarm-monitor 0.0.1 (old)"
  exit 0
fi
echo "old launcher should not run" >&2
exit 42
`
    );
    chmodSync(fakeLauncher, 0o755);
    writeFileSync(
      join(scriptsDir, "install-standalone.sh"),
      `#!/usr/bin/env sh
cat > "${fakeLauncher}" <<'EOF'
#!/usr/bin/env sh
if [ "$1" = "--version" ]; then
  echo "codex-swarm-monitor 0.1.0 (standalone, test)"
  exit 0
fi
{
  printf 'cwd=%s\\n' "$PWD"
  printf 'args=%s\\n' "$*"
} > "$CODEX_SWARM_CAPTURE"
EOF
chmod 755 "${fakeLauncher}"
`
    );
    chmodSync(join(scriptsDir, "install-standalone.sh"), 0o755);

    execFileSync(process.execPath, [join(scriptsDir, "start-monitor.mjs"), `--workspace=${workspace}`, "--port", "0"], {
      cwd: temp,
      env: {
        ...process.env,
        CODEX_SWARM_CAPTURE: capture,
        PATH: `${binDir}:/usr/bin:/bin`
      },
      stdio: "pipe"
    });

    const output = readFileSync(capture, "utf8");
    assert.doesNotMatch(output, /old shell launcher should not run/);
    assert.match(output, new RegExp(`args=--workspace=${escapeRegex(workspace)} --port 0 --connect --open`));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function assertShellStartScriptReinstallsMismatchedLauncher(shellStartScript) {
  if (process.platform === "win32") return;
  const temp = mkdtempSync(join(tmpdir(), "codex-swarm-shell-version-"));
  try {
    const scriptsDir = join(temp, "scripts");
    const pluginDir = join(temp, ".codex-plugin");
    const binDir = join(temp, "bin");
    const workspace = join(temp, "workspace");
    const capture = join(temp, "capture.txt");
    execFileSync("mkdir", ["-p", scriptsDir, pluginDir, binDir, workspace]);
    cpSync(shellStartScript, join(scriptsDir, "start-monitor.sh"));
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ version: "0.1.0" }));
    const fakeLauncher = join(binDir, "codex-swarm-monitor");
    writeFileSync(
      fakeLauncher,
      `#!/usr/bin/env sh
if [ "$1" = "--version" ]; then
  echo "codex-swarm-monitor 0x1x0 (old)"
  exit 0
fi
echo "old shell launcher should not run" >&2
exit 42
`
    );
    chmodSync(fakeLauncher, 0o755);
    writeFileSync(
      join(scriptsDir, "install-standalone.sh"),
      `#!/usr/bin/env sh
cat > "${fakeLauncher}" <<'EOF'
#!/usr/bin/env sh
if [ "$1" = "--version" ]; then
  echo "codex-swarm-monitor 0.1.0 (standalone, shell test)"
  exit 0
fi
{
  printf 'cwd=%s\\n' "$PWD"
  printf 'args=%s\\n' "$*"
} > "$CODEX_SWARM_CAPTURE"
EOF
chmod 755 "${fakeLauncher}"
`
    );
    chmodSync(join(scriptsDir, "install-standalone.sh"), 0o755);

    execFileSync("sh", [join(scriptsDir, "start-monitor.sh"), `--workspace=${workspace}`, "--port", "0"], {
      cwd: temp,
      env: {
        ...process.env,
        CODEX_SWARM_CAPTURE: capture,
        PATH: `${binDir}:/usr/bin:/bin`
      },
      stdio: "pipe"
    });

    const output = readFileSync(capture, "utf8");
    assert.doesNotMatch(output, /old shell launcher should not run/);
    assert.match(output, new RegExp(`args=--workspace=${escapeRegex(workspace)} --port 0 --connect --open`));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
