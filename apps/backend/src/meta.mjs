import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function productMeta(packageRoot = PACKAGE_ROOT) {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const buildInfoPath = join(packageRoot, "build-info.json");
  const buildInfo = existsSync(buildInfoPath) ? JSON.parse(readFileSync(buildInfoPath, "utf8")) : null;
  return {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    distribution: buildInfo ? "standalone" : "source",
    node: process.version,
    build: buildInfo,
    release: {
      endUserPath: "macOS app + standalone bundle",
      bootstrap: "app or standalone bundle starts the local monitor",
      userPrerequisites: ["Codex"],
      bundledRuntime: "Node runtime included in standalone bundles",
      endUsersNeedNode: false,
      endUsersNeedNpm: false,
      endUsersNeedOmx: false,
      realtimeTransport: "SSE",
      mockData: false,
      localOnly: true
    }
  };
}
