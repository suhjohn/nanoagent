import { randomUUID } from "node:crypto";
import type { AgentRunState, JsonLike } from "@nanoagent/kernel";
import { runSupportAgent, startOrResumeTenantRun } from "./index";

const states = new Map<string, AgentRunState<JsonLike>>();
const prompt =
  process.argv.slice(2).join(" ") ||
  "Reply with one concise sentence explaining model routing.";

await runSupportAgent({
  runId: process.env.SUPPORT_RUN_ID ?? randomUUID(),
  prompt,
  classifyPrompt: (input) => (input.length > 120 ? "hard" : "simple"),
  streamToClient: (event) => {
    console.log(`support:${event.type}`);
  },
});

await startOrResumeTenantRun({
  runId: process.env.TENANT_RUN_ID ?? randomUUID(),
  tenantId: process.env.TENANT_ID ?? "tenant_pro",
  prompt,
  deps: {
    classifyPrompt: (input) => (input.length > 120 ? "hard" : "simple"),
    loadState: async (runId) => states.get(runId) as never,
    loadTenant: async (tenantId) => ({
      id: tenantId,
      tier:
        process.env.TENANT_TIER === "enterprise" ||
        process.env.TENANT_TIER === "free"
          ? process.env.TENANT_TIER
          : "pro",
    }),
    saveState: async (runId, state) => {
      states.set(runId, state as never);
    },
    streamToClient: (event) => {
      console.log(`tenant:${event.type}`);
    },
    tools: {},
  },
});

console.log(
  JSON.stringify(
    {
      tenantRunsSaved: states.size,
    },
    null,
    2,
  ),
);
