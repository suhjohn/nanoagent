import type { AgentRunState, JsonLike } from "@nanoagent/kernel";
import { startOrResume } from "./index";

type Context = {
  [key: string]: JsonLike;
  customerId: string;
  sessionId: string;
};

const runId = process.env.RUN_ID ?? "replay-cli-run";
const toolCallId = process.env.TOOL_CALL_ID ?? "call-charge";
const states = new Map<string, AgentRunState<Context>>();
const charges: unknown[] = [];
const prompt =
  process.argv.slice(2).join(" ") ||
  "Resume the idempotent card charge and summarize the result.";

states.set(runId, {
  runId,
  revision: 1,
  updatedAt: new Date(0).toISOString(),
  status: { type: "running", phase: "tool_call_completed" },
  context: {
    customerId: process.env.CUSTOMER_ID ?? "cust_123",
    sessionId: runId,
  },
  turns: [],
  currentTurn: {
    turnId: "turn-1",
    turn: 1,
    modelArgs: {
      model: process.env.MODEL ?? "openai/gpt-5.4-mini",
      messages: [{ role: "user", content: prompt }],
      toolNames: ["ChargeCard"],
    },
    modelResult: {
      finishReason: "tool-calls",
      response: {
        id: "response-1",
        messages: [],
        modelId: "seeded",
        timestamp: new Date(0),
      },
      totalUsage: {
        inputTokens: 0,
        inputTokenDetails: {
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          noCacheTokens: 0,
        },
        outputTokens: 0,
        outputTokenDetails: {
          reasoningTokens: undefined,
          textTokens: 0,
        },
        totalTokens: 0,
      },
    },
    toolCalls: {
      pending: [],
      inFlight: [
        {
          toolCallId,
          toolName: "ChargeCard",
          input: { amountCents: 100, currency: "usd" },
        },
      ],
      completed: [],
    },
  },
});

await startOrResume({
  runId,
  customerId: process.env.CUSTOMER_ID ?? "cust_123",
  deps: {
    chargeGateway: {
      createCharge: async (params) => {
        charges.push(params);
        return { chargeId: "ch_123", status: "succeeded" };
      },
    },
    messages: {
      load: async () => [{ role: "user", content: prompt }],
    },
    modelProviders: {},
    store: {
      load: async (id) => states.get(id),
      save: async ({ state }) => {
        states.set(state.runId, state);
      },
    },
  },
});

console.log(
  JSON.stringify(
    {
      charges,
      finalStatus: states.get(runId)?.status,
    },
    null,
    2,
  ),
);
