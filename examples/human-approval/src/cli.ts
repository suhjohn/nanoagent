import { jsonSchema, tool } from "ai";
import type { ModelMessage } from "ai";
import type { AgentRunState, JsonLike } from "@nanoagent/kernel";
import { approveFromSlack, startOrResume } from "./index";

type Context = {
  [key: string]: JsonLike;
  approved: string[];
  sessionId: string;
  slackChannelId: string;
  userId: string;
};

const runId = process.env.RUN_ID ?? "approval-cli-run";
const toolCallId = process.env.TOOL_CALL_ID ?? "call-charge";
const states = new Map<string, AgentRunState<Context>>();
const slackPosts: unknown[] = [];
const charges: unknown[] = [];
const prompt =
  process.argv.slice(2).join(" ") ||
  "Approve and run the pending ChargeCard tool call, then summarize result.";

states.set(runId, {
  runId,
  revision: 1,
  updatedAt: new Date(0).toISOString(),
  status: { type: "running", phase: "model_completed" },
  context: {
    approved: [],
    sessionId: runId,
    slackChannelId: process.env.SLACK_CHANNEL_ID ?? "C123",
    userId: process.env.USER_ID ?? "U123",
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
      pending: [
        {
          toolCallId,
          toolName: "ChargeCard",
          input: { amountCents: 100, currency: "usd" },
        },
      ],
      inFlight: [],
      completed: [],
    },
  },
});

const deps = {
  messages: {
    append: async () => {},
    load: async () =>
      [
        {
          role: "user",
          content: prompt,
        },
      ] satisfies ModelMessage[],
  },
  modelProviders: {},
  slack: {
    postApproval: async (approval: unknown) => {
      slackPosts.push(approval);
    },
  },
  store: {
    load: async (id: string) => states.get(id),
    save: async ({ state }: { state: AgentRunState<Context> }) => {
      states.set(state.runId, state);
    },
  },
  tools: {
    ChargeCard: tool({
      description: "Charge customer card.",
      inputSchema: jsonSchema({
        type: "object",
        additionalProperties: true,
        properties: {},
      }),
      execute: async (input) => {
        charges.push(input);
        return { status: "succeeded" };
      },
    }),
  },
};

await startOrResume({
  deps,
  runId,
  slackChannelId: process.env.SLACK_CHANNEL_ID ?? "C123",
  userId: process.env.USER_ID ?? "U123",
});
await approveFromSlack({
  deps,
  runId,
  toolCallId,
});

console.log(
  JSON.stringify(
    {
      charges,
      finalStatus: states.get(runId)?.status,
      slackPosts,
    },
    null,
    2,
  ),
);
