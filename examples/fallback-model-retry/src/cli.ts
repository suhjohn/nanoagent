import type { AgentModelProviders } from "@nanoagent/kernel";
import { runInteractiveCli } from "../../common-cli/src";
import { runWithFallback } from "./index";

await runInteractiveCli({
  defaultPrompt: "Reply with one concise sentence explaining model fallback retry.",
  intro: "Fallback model retry example.",
  run: async ({ input, cli }) => {

    const failingProvider: AgentModelProviders = {
      broken: (modelName: string) => {
        return {
          specificationVersion: "v3",
          provider: "broken",
          modelId: modelName,
          supportedUrls: {},
          doGenerate: async () => {
            throw new Error("Rate limit exceeded");
          },
          doStream: async () => {
            throw new Error("Rate limit exceeded");
          },
        } as never;
      },
    };

    await runWithFallback({
      prompt: input,
      deps: {
        model: "broken/gpt-5.5",
        fallbackModel: "openai/gpt-5.5", // Defaults to the real provider
        modelProviders: failingProvider, // It will merge with default providers (like openai)
        streamToClient: (event) => cli.event(event),
      },
    });

  },
});
