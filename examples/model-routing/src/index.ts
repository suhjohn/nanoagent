import {
  type AgentHooks,
  type AgentModelProviders,
  type AgentStreamEvent,
  runAgent,
} from "@nanoagent/kernel";

export type SubscriptionLevel = "free" | "pro";
export type RoutedModel = "openai/gpt-5.4-mini" | "openai/gpt-5.5";

export type ModelRoutingContext = {
  prompt: string;
  routeReason: string;
  selectedModel: RoutedModel;
  subscriptionLevel: SubscriptionLevel;
};

export type ModelRoutingDeps = {
  getUserSubscriptionLevel(userId: string): Promise<SubscriptionLevel>;
  modelProviders?: AgentModelProviders;
  streamToClient?(event: AgentStreamEvent): void;
};

export function selectModel(subscriptionLevel: SubscriptionLevel): {
  model: RoutedModel;
  reason: string;
} {
  if (subscriptionLevel === "pro") {
    return {
      model: "openai/gpt-5.5",
      reason: "pro subscribers use gpt-5.5",
    };
  }

  return {
    model: "openai/gpt-5.4-mini",
    reason: "free subscribers use gpt-5.4-mini",
  };
}

function modelRoutingHooks(): AgentHooks<ModelRoutingContext> {
  return {
    onTurnPrepared: ({ context }) => {
      return {
        value: {
          model: context.selectedModel,
          messages: [{ role: "user", content: context.prompt }],
        },
      };
    },
  };
}

export async function runModelRouting(params: {
  deps: ModelRoutingDeps;
  runId: string;
  userId: string;
  prompt: string;
}) {
  const subscriptionLevel = await params.deps.getUserSubscriptionLevel(
    params.userId,
  );
  const route = selectModel(subscriptionLevel);

  const context: ModelRoutingContext = {
    prompt: params.prompt,
    routeReason: route.reason,
    selectedModel: route.model,
    subscriptionLevel,
  };

  for await (const event of runAgent<ModelRoutingContext>({
    state: { context, runId: params.runId },
    modelProviders: params.deps.modelProviders,
    hooks: modelRoutingHooks(),
    maxTurns: 1,
  })) {
    params.deps.streamToClient?.(event);
  }

  return context;
}
