import { randomUUID } from "node:crypto";
import type { AgentStreamEvent } from "@nanoagent/kernel";
import { runInteractiveCli } from "../../common-cli/src";
import {
  type SubscriptionLevel,
  runModelRouting,
} from "./index";

await runInteractiveCli({
  defaultPrompt: "How do I upgrade to pro?",
  intro: "Model routing example (using actual API).",
  run: async ({ input, cli }) => {
    const runId = process.env.RUN_ID ?? randomUUID();
    const userId = process.env.USER_ID ?? "user_123";
    const subscriptionLevel = parseSubscriptionLevel(
      process.env.SUBSCRIPTION_LEVEL,
    );

    const deps = {
      getUserSubscriptionLevel: async () => subscriptionLevel,
      // By omitting modelProviders, the kernel will default to the real
      // AI SDK providers which will use your environment's API keys.
      streamToClient: (event: AgentStreamEvent) => cli.event(event),
    };

    const context = await runModelRouting({
      deps,
      prompt: input,
      runId,
      userId,
    });

    cli.json({
      routeReason: context.routeReason,
      runId,
      selectedModel: context.selectedModel,
      subscriptionLevel: context.subscriptionLevel,
      userId,
    });
  },
});

function parseSubscriptionLevel(value: string | undefined): SubscriptionLevel {
  if (value === "pro") return "pro";
  return "free";
}
