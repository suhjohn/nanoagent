import { jsonSchema, tool } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import {
  type AgentModelProviders,
  type AgentRunState,
  type AgentSaveState,
  type JsonLike,
  runAgent,
} from "@nanoagent/kernel";

type Context = {
  [key: string]: JsonLike;
  customerId: string;
  sessionId: string;
};

type ChargeInput = {
  amountCents: number;
  currency: "usd";
};

type ChargeResult = {
  chargeId: string;
  status: "succeeded";
};

type ChargeGateway = {
  createCharge(params: {
    amountCents: number;
    currency: "usd";
    customerId: string;
    idempotencyKey: string;
  }): Promise<ChargeResult>;
};

type RunStore = {
  load(runId: string): Promise<AgentRunState<Context> | undefined>;
  save(params: Parameters<AgentSaveState<Context>>[0]): Promise<void>;
};

type MessageStore = {
  load(sessionId: string): Promise<ModelMessage[]>;
};

type IdempotentReplayDeps = {
  chargeGateway: ChargeGateway;
  messages: MessageStore;
  modelProviders: AgentModelProviders;
  store: RunStore;
};

function makeTools(chargeGateway: ChargeGateway) {
  return {
    ChargeCard: tool({
      description:
        "Charge customer card exactly once using tool call idempotency.",
      inputSchema: jsonSchema<ChargeInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          amountCents: { type: "number" },
          currency: { type: "string", enum: ["usd"] },
        },
        required: ["amountCents", "currency"],
      }),
      execute: async ({ amountCents, currency }, options) => {
        const context = options.experimental_context as Context;

        return chargeGateway.createCharge({
          customerId: context.customerId,
          amountCents,
          currency,
          idempotencyKey: options.toolCallId,
        });
      },
    }),
  } satisfies ToolSet;
}

function replayIdempotentChargeCalls(
  state: AgentRunState<Context>,
): AgentRunState<Context> {
  if (state.status.type !== "running") return state;
  if (state.status.phase !== "tool_call_completed") return state;

  const turn = state.currentTurn;
  if (!turn?.toolCalls.inFlight.length) return state;

  const canReplay = turn.toolCalls.inFlight.every(
    (call) => call.toolName === "ChargeCard",
  );
  if (!canReplay) return state;

  return {
    ...state,
    status: {
      ...state.status,
      phase: "tool_call_started",
    },
    currentTurn: {
      ...turn,
      toolCalls: {
        pending: turn.toolCalls.inFlight,
        inFlight: [],
        completed: turn.toolCalls.completed,
      },
    },
  };
}

function makeSaveState(store: RunStore): AgentSaveState<Context> {
  return ({ state, events }) => store.save({ state, events });
}

export async function startOrResume(params: {
  customerId: string;
  deps: IdempotentReplayDeps;
  runId: string;
}) {
  const saved = await params.deps.store.load(params.runId);
  const state = saved
    ? replayIdempotentChargeCalls(saved)
    : {
        runId: params.runId,
        context: {
          customerId: params.customerId,
          sessionId: params.runId,
        },
      };

  for await (const event of runAgent<Context>({
    state,
    tools: makeTools(params.deps.chargeGateway),
    modelProviders: params.deps.modelProviders,
    hooks: {
      onTurnPrepared: async ({ context }) => ({
        value: {
          model: "openai/gpt-5",
          messages: await params.deps.messages.load(context.sessionId),
        },
      }),
    },
    maxTurns: 10,
    saveState: makeSaveState(params.deps.store),
  })) {
    console.log(event.type);
  }
}
