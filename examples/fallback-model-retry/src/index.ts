import type { ModelMessage, ToolSet } from "ai";
import {
  type AgentCallModelArgs,
  type AgentCallModelResult,
  type AgentHooks,
  type AgentMiddleware,
  type AgentModelProviders,
  type AgentRunState,
  type AgentStreamEvent,
  type JsonLike,
  runAgent,
} from "@nanoagent/kernel";

type Context = {
  [key: string]: JsonLike;
  sessionId: string;
  tenant: "public" | "enterprise";
};

type MessageStore = {
  append(sessionId: string, messages: ModelMessage[]): Promise<void>;
  load(sessionId: string): Promise<ModelMessage[]>;
};

type FallbackDeps = {
  fallbackModel?: string;
  loadState(runId: string): Promise<AgentRunState<Context> | undefined>;
  messages: MessageStore;
  model?: string;
  modelProviders: AgentModelProviders;
  saveState(runId: string, state: AgentRunState<Context>): Promise<void>;
  streamToClient(event: AgentStreamEvent): void;
  tools: ToolSet;
};

type CallModelMiddleware = AgentMiddleware<
  AgentCallModelArgs<Context>,
  AgentCallModelResult
>;

function isRetryableProviderError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /rate limit|timeout|temporarily unavailable/i.test(error.message);
}

function backoffMs(attempt: number) {
  return 500 * 2 ** attempt;
}

const retryWithFallbackModel =
  (params: {
    attempts: number;
    fallbackModel: string;
    sleep: (ms: number) => Promise<void>;
  }): CallModelMiddleware =>
  async ({ input, next }) => {
    for (let attempt = 0; attempt < params.attempts; attempt++) {
      const model = attempt === 0 ? input.args.model : params.fallbackModel;

      try {
        return await next({
          ...input,
          args: {
            ...input.args,
            model,
          },
        });
      } catch (error) {
        if (
          attempt + 1 >= params.attempts ||
          !isRetryableProviderError(error)
        ) {
          throw error;
        }

        await params.sleep(backoffMs(attempt));
      }
    }

    throw new Error("retry attempts must be greater than zero");
  };

function makeHooks(params: {
  messages: MessageStore;
  model?: string;
}): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context }) => ({
      value: {
        model:
          params.model ??
          (context.tenant === "enterprise"
            ? "openai/gpt-5.4-mini"
            : "openai/gpt-5.4-mini"),
        messages: await params.messages.load(context.sessionId),
      },
    }),
    onTurnCompleted: async ({ context, turn }) => {
      const modelResult = turn.modelResult;
      if (!modelResult) return;

      await params.messages.append(
        context.sessionId,
        modelResult.response.messages,
      );
    },
  };
}

export async function runWithFallback(params: {
  deps: FallbackDeps;
  initialMessages: ModelMessage[];
  runId: string;
  sleep: (ms: number) => Promise<void>;
}) {
  const saved = await params.deps.loadState(params.runId);
  const state: AgentRunState<Context> | { runId: string; context: Context } =
    saved ?? {
      runId: params.runId,
      context: {
        sessionId: params.runId,
        tenant: "public",
      },
    };

  if (!saved) {
    await params.deps.messages.append(params.runId, params.initialMessages);
  }

  for await (const event of runAgent<Context>({
    state,
    tools: params.deps.tools,
    modelProviders: params.deps.modelProviders,
    hooks: makeHooks({
      messages: params.deps.messages,
      model: params.deps.model,
    }),
    maxTurns: 10,
    saveState: async ({ state }) => {
      await params.deps.saveState(state.runId, state);
    },
    middleware: {
      callModel: [
        retryWithFallbackModel({
          attempts: 2,
          fallbackModel: params.deps.fallbackModel ?? "openai/gpt-5.4-mini",
          sleep: params.sleep,
        }),
      ],
    },
  })) {
    params.deps.streamToClient(event);
  }
}
