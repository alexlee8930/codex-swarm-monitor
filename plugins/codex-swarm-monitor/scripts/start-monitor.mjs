#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = optionValue("--workspace", "-w") || process.cwd();
const forwarded = process.argv.slice(2);
const exitOnly = hasAny("--help", "-h", "--version", "-v", "--support");
const requiredVersion = pluginVersion();
if (!hasOption("--workspace", "-w")) forwarded.push("--workspace", workspace);
if (!hasOption("--connect") && !hasOption("--doctor") && !hasOption("--support") && !exitOnly) forwarded.push("--connect");
if (!hasOption("--open") && !hasOption("--doctor") && !hasOption("--support") && !exitOnly) forwarded.push("--open");

const sourceRoot = findSourceRoot(here);
if (sourceRoot) {
  await run(process.execPath, [join(sourceRoot, "apps/backend/src/index.mjs"), ...forwarded], sourceRoot);
  process.exit(0);
}

const installed = commandOnPath("codex-swarm-monitor");
if (installed && launcherVersionOk(installed, requiredVersion)) {
  await run(installed, forwarded, workspace);
  process.exit(0);
}

const bootstrapped = await installStandalone().catch((error) => {
  throw new Error(`${bootstrapFailureMessage()}\nOriginal error: ${error.message}`);
});
if (bootstrapped) {
  await run(bootstrapped, forwarded, workspace);
  process.exit(0);
}

if (process.env.CODEX_SWARM_ALLOW_NPX === "1") {
  await run("npx", ["--yes", "codex-swarm-monitor@latest", ...forwarded], workspace);
  process.exit(0);
}

throw new Error(bootstrapFailureMessage());

process.exit(0);

function optionValue(...names) {
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    for (const name of names) {
      if (arg === name) return process.argv[index + 1] || null;
      if (arg.startsWith(`${name}=`)) return arg.split("=").slice(1).join("=");
    }
  }
  return null;
}

function hasAny(...names) {
  return names.some((name) => process.argv.includes(name));
}

function hasOption(...names) {
  return process.argv.some((arg) => names.some((name) => arg === name || arg.startsWith(`${name}=`)));
}

function findSourceRoot(start) {
  let current = resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(current, "apps/backend/src/index.mjs"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function commandOnPath(command) {
  const extensions = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
  for (const dir of String(process.env.PATH || "").split(process.platform === "win32" ? ";" : ":")) {
    for (const ext of extensions) {
      const candidate = join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function pluginVersion() {
  const pluginJson = join(here, "../.codex-plugin/plugin.json");
  if (!existsSync(pluginJson)) return null;
  try {
    return JSON.parse(readFileSync(pluginJson, "utf8")).version || null;
  } catch {
    return null;
  }
}

function launcherVersionOk(launcher, version) {
  if (!version) return true;
  try {
    const stdout = execFileSync(launcher, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return new RegExp(`(^|\\s)${escapeRegex(version)}([\\s,)]|$)`).test(stdout);
  } catch {
    return false;
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function installStandalone() {
  const script = process.platform === "win32" ? join(here, "install-standalone.ps1") : join(here, "install-standalone.sh");
  if (!existsSync(script)) return null;
  if (process.platform === "win32") {
    await run("powershell", ["-ExecutionPolicy", "Bypass", "-File", script], workspace);
  } else {
    await run("sh", [script], workspace);
  }
  return commandOnPath("codex-swarm-monitor") || defaultInstalledLauncher();
}

function defaultInstalledLauncher() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData ? existing(join(localAppData, "CodexSwarmMonitor/bin/codex-swarm-monitor.cmd")) : null;
  }
  return existing(join(process.env.HOME || "", ".local/bin/codex-swarm-monitor"));
}

function bootstrapFailureMessage() {
  const releaseVersion = process.env.CODEX_SWARM_RELEASE_VERSION || "v0.1.0";
  const releaseBase = process.env.CODEX_SWARM_RELEASE_BASE || `${pluginRepositoryUrl()}/releases/download/${releaseVersion}`;
  const releaseDir = process.env.CODEX_SWARM_RELEASE_DIR || "<download from release base>";
  const target = process.env.CODEX_SWARM_TARGET || `${process.platform}-${process.arch}`;
  const defaultLauncher =
    process.platform === "win32"
      ? join(process.env.LOCALAPPDATA || "%LOCALAPPDATA%", "CodexSwarmMonitor/bin/codex-swarm-monitor.cmd")
      : join(process.env.HOME || "$HOME", ".local/bin/codex-swarm-monitor");
  return [
    "codex-swarm-monitor is not installed and standalone bootstrap did not produce a launcher.",
    `  release version: ${releaseVersion}`,
    `  release base: ${releaseBase}`,
    `  release dir: ${releaseDir}`,
    `  target: ${target}`,
    `  checked PATH plus: ${defaultLauncher}`,
    "Publish the matching release archive/checksum or set CODEX_SWARM_RELEASE_DIR for an offline install.",
    "Set CODEX_SWARM_ALLOW_NPX=1 only for package verification fallback."
  ].join("\n");
}

function pluginRepositoryUrl() {
  const pluginJson = join(here, "../.codex-plugin/plugin.json");
  if (!existsSync(pluginJson)) return "https://github.com/codex-swarm-monitor/codex-swarm-monitor";
  try {
    const repository = JSON.parse(readFileSync(pluginJson, "utf8")).repository;
    return repository || "https://github.com/codex-swarm-monitor/codex-swarm-monitor";
  } catch {
    return "https://github.com/codex-swarm-monitor/codex-swarm-monitor";
  }
}

function existing(path) {
  return path && existsSync(path) ? path : null;
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0 || code === null) resolveRun();
      else rejectRun(new Error(`${command} exited with code ${code}`));
    });
  });
}
