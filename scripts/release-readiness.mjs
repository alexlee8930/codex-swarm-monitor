#!/usr/bin/env node

import { formatReleaseReadiness, releaseReadiness } from "../apps/backend/src/release-readiness.mjs";

const strict = process.argv.includes("--strict");
const summary = releaseReadiness();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(formatReleaseReadiness(summary));
}

if (strict && !summary.strictOk) process.exit(1);
