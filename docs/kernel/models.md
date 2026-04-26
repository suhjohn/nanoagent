# Models

Model selection is turn input. `onTurnPrepared` returns exact model args for current turn, including `model` and `messages`. Kernel adds `toolNames` and stores returned value on `state.currentTurn.modelArgs`.

Model names use `<provider>/<model-name>`:

```ts
import type { ModelMessage } from "ai";

const hooks: AgentHooks<Context> = {
  onTurnPrepared: ({ context }) => ({
    value: {
      model:
        context.complexity === "hard"
          ? "anthropic/claude-opus-4-7"
          : "openai/gpt-5-nano",
      messages: context.messages,
    },
  }),
};
```

Provider segment selects entry in `modelProviders`. Kernel trims and lowercases provider segment, then passes remainder after first slash, trimmed, to provider factory as model name.

## Provider Registry

`modelProviders` is caller-owned registry of provider factories.

Kernel default provider keys are `openai`, `anthropic`, `azure`, `baseten`, `cerebras`, `cohere`, `deepinfra`, `deepseek`, `fireworks`, `google`, `gemini`, `vertex`, `google-vertex`, `groq`, `grok`, `mistral`, `perplexity`, `together`, `togetherai`, `bedrock`, `amazon-bedrock`, `vercel`, and `xai`.

Custom entries supplied as `modelProviders` are normalized by provider key before merging over defaults. Keys are trimmed, lowercased, and empty keys are ignored. Use stable lowercase keys in docs and tests so selected model strings match persisted state.

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { runAgent, type AgentHooks } from "@nanoagent/kernel";
import type { ModelMessage } from "ai";

type Context = {
  tenant: "public" | "enterprise";
  messages: ModelMessage[];
};

const modelProviders = {
  "enterprise-gateway": createAnthropic({
    baseURL: "https://llm-gateway.internal/anthropic",
    apiKey: process.env.GATEWAY_TOKEN,
    fetch: mtlsFetch,
  }),
  "local-openai": createOpenAI({
    baseURL: "http://127.0.0.1:11434/v1",
    apiKey: "local",
  }),
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: ({ context }) => ({
    value: {
      model:
        context.tenant === "enterprise"
          ? "enterprise-gateway/claude-opus-4-7"
          : "openai/gpt-5-nano",
      messages: context.messages,
    },
  }),
};

for await (const event of runAgent<Context>({
  state,
  tools,
  modelProviders,
  hooks,
  maxTurns: 20,
  saveState,
})) {
  streamToClient(event);
}
```

Provider construction owns credentials, base URLs, headers, mTLS fetch, tenant routing, and local gateway configuration.

## Per-Turn Routing

`onTurnPrepared` runs before each model call. Use it to choose model from durable `context`, current turn number, stored transcript, tenant policy, or product state.

```ts
import type { ModelMessage } from "ai";

type Context = {
  complexity: "simple" | "hard";
  tenant: "free" | "pro" | "enterprise";
  messages: ModelMessage[];
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: ({ context, turn }) => {
    const model =
      context.tenant === "enterprise"
        ? "enterprise-gateway/claude-opus-4-7"
        : turn === 1 || context.complexity === "hard"
          ? "anthropic/claude-opus-4-7"
          : "openai/gpt-5-nano";

    return {
      value: {
        model,
        messages: context.messages,
      },
    };
  },
};
```

Returned value becomes `state.currentTurn.modelArgs`. Resume from `turn_prepared` or `model_started` uses committed `currentTurn.modelArgs`; `onTurnPrepared` is not called again for that turn.

## Resume Routing

Routing decisions that must survive resume belong in `context`.

```ts
type Context = {
  tenantId: string;
  route?: {
    provider: "openai" | "enterprise-gateway";
    model: string;
  };
  messages: ModelMessage[];
};

const hooks: AgentHooks<Context> = {
  onRunStarted: ({ context }) => ({
    context: {
      ...context,
      route: routeForTenant(context.tenantId),
    },
  }),
  onTurnPrepared: ({ context }) => {
    const route = context.route ?? routeForTenant(context.tenantId);

    return {
      value: {
        model: `${route.provider}/${route.model}`,
        messages: context.messages,
      },
    };
  },
};
```

Persisted `AgentRunState.context` carries route. A resumed worker does not need UI state or request headers to choose same route.

## Custom Gateway

Gateway providers are normal AI SDK providers. Register gateway under stable provider key, then select it with model string.

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { runAgent, type AgentHooks } from "@nanoagent/kernel";
import type { ModelMessage } from "ai";

type Context = {
  requiresDataBoundary: boolean;
  messages: ModelMessage[];
};

const gateway = createOpenAI({
  baseURL: "https://models.company.internal/v1",
  apiKey: process.env.MODEL_GATEWAY_TOKEN,
  headers: {
    "x-product": "support-agent",
  },
  fetch: async (input, init) =>
    signedFetch(input, {
      ...init,
      signal: init?.signal,
    }),
});

const modelProviders = {
  gateway,
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: ({ context }) => ({
    value: {
      model: context.requiresDataBoundary
        ? "gateway/claude-sonnet-4-6"
        : "openai/gpt-5-nano",
      messages: context.messages,
    },
  }),
};

for await (const event of runAgent<Context>({
  state,
  tools,
  modelProviders,
  hooks,
  maxTurns: 20,
  saveState,
})) {
  streamToClient(event);
}
```

Kernel resolves `gateway/claude-sonnet-4-6` by calling `modelProviders.gateway("claude-sonnet-4-6")`.
