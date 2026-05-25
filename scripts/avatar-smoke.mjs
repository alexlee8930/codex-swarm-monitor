#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let child;

const roster = [
  ["main", "Orchestrator", "b6e3f4"],
  ["planner", "Planner", "d1d4f9"],
  ["explorer", "Explorer", "ffd5dc"],
  ["builder", "Builder", "c0aede"],
  ["reviewer", "Reviewer", "ffdfbf"],
  ["tester", "Tester", "c0e8d5"]
];

try {
  const boot = await startMonitor();
  child = boot.child;
  const hashes = new Set();

  for (const [name, role, backgroundColor] of roster) {
    const url = `${boot.url}/avatar?name=${encodeURIComponent(name)}&role=${encodeURIComponent(role)}&backgroundColor=${backgroundColor}`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    const svg = await response.text();
    assert.match(svg, /^<svg /);
    assert.match(svg, /viewBox="0 0 96 96"/);
    assert.match(svg, /role="img"/);
    assert.match(svg, new RegExp(`aria-label="${name} avatar"`));
    assert.match(svg, /data-avatar-style="notion-local-portrait"/);
    assert.match(svg, /data-avatar-version="7"/);
    assert.match(svg, /<clipPath id="avatar-frame">/);
    assert.match(svg, /stroke-linecap="round"/);
    assert.match(svg, /#1f2328|#24292f|#202124/);
    assert.doesNotMatch(svg, /<text/i);
    assert.doesNotMatch(svg, /dicebear|api\.dicebear|<image|href=/i);
    assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
    hashes.add(createHash("sha256").update(svg).digest("hex"));
  }

  assert.equal(hashes.size, roster.length, "each core role should have a distinct deterministic portrait");
  console.log("avatar smoke ok");
} finally {
  if (child) child.kill("SIGTERM");
}

function startMonitor() {
  return new Promise((resolveStart, rejectStart) => {
    const proc = spawn(process.execPath, ["apps/backend/src/index.mjs", "--port", "0"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectStart(error);
      else resolveStart(value);
    };
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      finish(new Error(`Timed out waiting for monitor URL: ${stdout}${stderr}`));
    }, 5000);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) finish(null, { child: proc, url: match[0] });
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => finish(error));
    proc.on("close", (code) => {
      if (!stdout.match(/http:\/\/127\.0\.0\.1:\d+/)) {
        finish(new Error(`Monitor exited ${code}: ${stderr}`));
      }
    });
  });
}
