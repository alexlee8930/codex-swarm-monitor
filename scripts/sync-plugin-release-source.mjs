#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));
const repo = normalizeGithubRepo(options.repo || gitOrigin());

if (!repo) {
  throw new Error("Missing GitHub repo. Pass --repo https://github.com/<owner>/<repo> or configure git origin.");
}

const baseUrl = `https://github.com/${repo}`;
const pluginPath = join(root, "plugins/codex-swarm-monitor/.codex-plugin/plugin.json");
const packagePath = join(root, "package.json");
const plugin = readJson(pluginPath);
const packageJson = readJson(packagePath);

plugin.repository = baseUrl;
plugin.homepage = baseUrl;
plugin.interface = {
  ...plugin.interface,
  websiteURL: baseUrl,
  privacyPolicyURL: `${baseUrl}/blob/main/docs/privacy.md`,
  termsOfServiceURL: `${baseUrl}/blob/main/LICENSE`
};

packageJson.repository = {
  type: "git",
  url: `${baseUrl}.git`
};
packageJson.homepage = baseUrl;

writeJson(pluginPath, plugin);
writeJson(packagePath, packageJson);

console.log(JSON.stringify({
  ok: true,
  repository: baseUrl,
  plugin: relative(pluginPath),
  package: relative(packagePath)
}, null, 2));

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") parsed.repo = args[++index];
    else if (arg.startsWith("--repo=")) parsed.repo = arg.split("=").slice(1).join("=");
  }
  return parsed;
}

function gitOrigin() {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function normalizeGithubRepo(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  const normalized = input
    .replace(/^git@github\.com:/, "")
    .replace(/^ssh:\/\/git@github\.com\//, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^http:\/\/github\.com\//, "")
    .replace(/\/releases\/download\/.*$/, "")
    .replace(/\/blob\/.*$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : "";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function relative(path) {
  return path.replace(`${root}/`, "");
}
