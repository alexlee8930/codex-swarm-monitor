import { productMeta } from "./meta.mjs";
import { releaseReadiness } from "./release-readiness.mjs";
import { systemDoctor } from "./system.mjs";
import { analyzeWorkspace } from "./workspace.mjs";

export async function createSupportBundle({ store, workspace }) {
  const state = store.state({ workspace });
  return {
    generatedAt: new Date().toISOString(),
    service: "codex-swarm-monitor",
    privacy: {
      localOnly: true,
      syntheticEvents: false,
      secretsRedactedBeforePersistence: true,
      note: "This bundle contains local workspace paths, hook status, release readiness, and recent redacted event summaries."
    },
    version: productMeta(),
    workspace: await analyzeWorkspace(workspace),
    doctor: await systemDoctor(workspace),
    release: releaseReadiness(undefined, { inspectPublished: false }),
    state: {
      metrics: state.metrics,
      agents: state.agents,
      files: state.files.slice(0, 50),
      edges: state.edges,
      events: state.events.slice(-50),
      retention: state.retention
    }
  };
}
