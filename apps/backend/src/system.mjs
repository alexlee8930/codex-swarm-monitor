import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { productMeta } from "./meta.mjs";

export async function systemReadiness() {
  const codex = await commandVersion("codex", ["--version"]);
  const meta = productMeta();
  const node = {
    ok: Number(process.versions.node.split(".")[0]) >= 24,
    version: process.version
  };
  const runtime = {
    ...node,
    label: meta.distribution === "standalone" ? "Bundled runtime" : "Development runtime",
    distribution: meta.distribution
  };

  return {
    runtime,
    node,
    codex,
    ready: runtime.ok && codex.ok
  };
}

export async function systemDoctor(workspacePath = process.cwd()) {
  const root = resolve(String(workspacePath || process.cwd()));
  const readiness = await systemReadiness();
  const doctor = readiness.codex.ok ? await codexDoctor(root) : { ok: false, error: "codex not found" };
  const workspace = await workspaceProbe(root);
  const checks = [
    check(
      "runtime",
      readiness.runtime.ok,
      `${readiness.runtime.label} ${readiness.runtime.version}`,
      "Use the standalone bundle or Codex plugin bootstrap. For development, run with Node 24 or newer."
    ),
    check("codex", readiness.codex.ok, readiness.codex.version || readiness.codex.error, "Install Codex and run codex login."),
    check(
      "codex-doctor",
      doctor.ok,
      doctor.summary || doctor.error,
      doctor.remediation || "Run codex doctor --summary and fix reported issues."
    ),
    check("workspace-readable", workspace.readable, root, "Choose a readable local folder."),
    check("workspace-writable", workspace.writable, root, "Choose a writable local folder so hooks can be installed."),
    check(
      "hook-installed",
      workspace.hookInstalled,
      workspace.hookPath,
      "Click Install hooks before running Codex from this workspace.",
      true
    )
  ];

  return {
    ok: checks.every((item) => item.ok || item.optional),
    workspace: root,
    checks,
    readiness: { ...readiness, doctor }
  };
}

function commandVersion(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 2500 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: stderr.trim() || error.message });
        return;
      }
      resolve({ ok: true, version: stdout.trim() });
    });
  });
}

function codexDoctor(cwd) {
  return new Promise((resolveDoctor) => {
    execFile("codex", ["doctor", "--json"], { cwd, timeout: 5000 }, (error, stdout, stderr) => {
      if (error && !stdout.trim()) {
        resolveDoctor({ ok: false, error: stderr.trim() || error.message });
        return;
      }

      try {
        const report = JSON.parse(stdout);
        const failing = Object.values(report.checks || {}).filter((item) => item.status === "fail");
        resolveDoctor({
          ok: report.overallStatus === "ok",
          status: report.overallStatus,
          summary: failing.length ? `${failing.length} failing Codex doctor check(s)` : "Codex doctor passed",
          remediation: failing.map((item) => item.remediation).filter(Boolean).join(" ") || null,
          failing: failing.map((item) => ({
            id: item.id,
            summary: item.summary,
            remediation: item.remediation
          }))
        });
      } catch {
        resolveDoctor({ ok: false, error: "codex doctor returned non-JSON output" });
      }
    });
  });
}

async function workspaceProbe(root) {
  const hookPath = join(root, ".codex", "codex-swarm-monitor", "hook.mjs");
  return {
    readable: await canAccess(root, constants.R_OK),
    writable: await canAccess(root, constants.W_OK),
    hookInstalled: await canAccess(hookPath, constants.R_OK),
    hookPath
  };
}

async function canAccess(path, mode) {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

function check(id, ok, summary, remediation, optional = false) {
  return { id, ok, optional, summary: String(summary || ""), remediation: ok ? null : remediation };
}
