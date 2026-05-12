import { randomUUID } from "node:crypto";
import type { AgentRunState, JsonLike } from "@nanoagent/kernel";
import type { ModelMessage } from "ai";
import { runWithFallback } from "./index";

type Context = {
  [key: string]: JsonLike;
  sessionId: string;
  tenant: "public" | "enterprise";
};

const runId = process.env.RUN_ID ?? randomUUID();
const prompt =
  process.argv.slice(2).join(" ") ||
  "Reply with one concise sentence explaining model fallback retry.";
const states = new Map<string, AgentRunState<Context>>();
const messages = new Map<string, ModelMessage[]>();

await runWithFallback({
  runId,
  initialMessages: [
    {
      role: "user",
      content: prompt,
    },
  ],
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  deps: {
    loadState: async (id) => states.get(id),
    model: process.env.MODEL ?? "openai/gpt-5.4-mini",
    saveState: async (id, state) => {
      states.set(id, state);
    },
    fallbackModel: process.env.FALLBACK_MODEL ?? "openai/gpt-5.4-mini",
    messages: {
      append: async (sessionId, next) => {
        messages.set(sessionId, [...(messages.get(sessionId) ?? []), ...next]);
      },
      load: async (sessionId) => messages.get(sessionId) ?? [],
    },
    modelProviders: {},
    streamToClient: (event) => {
      console.log(event.type);
    },
    tools: {},
  },
});

console.log(
  JSON.stringify(
    {
      messages: messages.get(runId)?.length ?? 0,
      runId,
      status: states.get(runId)?.status,
    },
    null,
    2,
  ),
);
