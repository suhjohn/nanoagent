import type { ModelMessage } from "ai";
import {
  type AgentCallModelArgs,
  type AgentCallModelResult,
  type AgentMiddleware,
  type AgentModelProviders,
  type AgentStreamEvent,
  runAgent,
} from "@nanoagent/kernel";

type FallbackDeps = {
  fallbackModel: string;
  model: string;
  modelProviders?: AgentModelProviders;
  streamToClient(event: AgentStreamEvent): void;
};

type CallModelMiddleware = AgentMiddleware<
  AgentCallModelArgs<{}>,
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

        console.log(`[Middleware] Caught retryable error: ${error instanceof Error ? error.message : error}. Retrying with ${params.fallbackModel}...`);
        await params.sleep(backoffMs(attempt));
      }
    }

    throw new Error("retry attempts must be greater than zero");
  };

export async function runWithFallback(params: {
  deps: FallbackDeps;
  prompt: string;
}) {
  for await (const event of runAgent<{}>({
    state: { runId: "fallback-run", context: {} },
    modelProviders: params.deps.modelProviders,
    hooks: {
      onTurnPrepared: () => ({
        value: {
          model: params.deps.model,
          messages: [{ role: "user", content: params.prompt }],
        },
      }),
    },
    maxTurns: 1,
    middleware: {
      callModel: [
        retryWithFallbackModel({
          attempts: 2,
          fallbackModel: params.deps.fallbackModel,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        }),
      ],
    },
  })) {
    params.deps.streamToClient(event);
  }
}
