import { jsonSchema, tool, type ModelMessage } from "ai";
import { type JsonLike, runAgent, type AgentStreamEvent, type AgentRunState, type AgentRunStatus, type AgentModelProviders, type AgentHooks } from "@nanoagent/kernel";

export type ChatMessage = {
  [key: string]: JsonLike;
  role: "system" | "user" | "assistant" | "tool";
  content: string | any;
};

export type Context = {
  [key: string]: JsonLike;
  customerId: string;
  messages: ChatMessage[];
};

export type ChargeResult = {
  chargeId: string;
  status: "succeeded";
};

export type ChargeGateway = {
  createCharge(params: {
    amountCents: number;
    currency: "usd";
    customerId: string;
    idempotencyKey: string;
  }): Promise<ChargeResult>;
};

export type IdempotentReplayDeps = {
  chargeGateway: ChargeGateway;
  modelProviders?: AgentModelProviders;
  streamToClient?: (event: AgentStreamEvent) => void;
};

export function makeTools(chargeGateway: ChargeGateway) {
  return {
    ChargeCard: tool({
      description: "Charge customer card exactly once using tool call idempotency.",
      inputSchema: jsonSchema<{ amountCents: number; currency: "usd" }>({
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
  };
}

export function replayIdempotentChargeCalls(
  state: AgentRunState<Context>,
): AgentRunState<Context> {
  if (state.status.type !== "running") return state;
  if (
    state.status.phase !== "tool_call_started" &&
    state.status.phase !== "tool_call_completed"
  ) {
    return state;
  }

  const turn = state.currentTurn;
  if (!turn?.toolCalls.inFlight.length) return state;

  // Only safely replay if all in-flight tools are ChargeCard
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

function makeHooks(): AgentHooks<Context> {
  return {
    onTurnPrepared: ({ context, state }) => ({
      value: {
        model: "openai/gpt-5.4-mini",
        messages: context.messages as unknown as ModelMessage[],
        toolChoice: state.turns.length === 0 ? { type: "tool", toolName: "ChargeCard" } : "auto",
      },
    }),

    onTurnCompleted: ({ context, turn }) => {
      if (!turn.modelResult) return;
      
      const newMessages = [...turn.modelResult.response.messages] as unknown as ChatMessage[];

      if (turn.toolCalls.completed.length > 0) {
        newMessages.push({
          role: "tool",
          content: turn.toolCalls.completed.map((toolCall) => ({
            type: "tool-result",
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            output: (toolCall.output ?? toolCall.error) as any,
          })),
        });
      }

      return {
        context: {
          ...context,
          messages: [...context.messages, ...newMessages],
        },
      };
    },
  };
}

export async function startOrResume(params: {
  deps: IdempotentReplayDeps;
  state: AgentRunState<Context> | { runId: string; context: Context };
  signal?: AbortSignal;
}) {
  let finalState: AgentRunState<Context> | undefined;

  // Before starting, try to recover any in-flight idempotent tool calls
  const state = "status" in params.state 
    ? replayIdempotentChargeCalls(params.state) 
    : params.state;

  for await (const event of runAgent<Context>({
    state,
    tools: makeTools(params.deps.chargeGateway),
    modelProviders: params.deps.modelProviders,
    hooks: makeHooks(),
    maxTurns: 3,
    saveState: async ({ state }) => {
      finalState = state;
    },
    signal: params.signal,
  })) {
    params.deps.streamToClient?.(event);
  }

  return finalState;
}
