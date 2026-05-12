# Middleware

Middleware wraps model and tool boundaries. It receives current input plus `next(input)`.

Each middleware can call `next` zero times, once, or many times:

- Zero: replace operation from cache, fixture, policy denial, or short-circuit.
- Once: observe, transform input, transform output, add timeout or metrics.
- Many: retry, fallback, repair malformed output, or ask model again.

Middleware functions compose in array order. First middleware wraps later middleware and terminal operation.

## Shape

Middleware is generic over input and output:

```ts
type AgentMiddlewareNext<Input, Output> = (input: Input) => Promise<Output>;

type AgentMiddleware<Input, Output> = (args: {
  input: Input;
  next: AgentMiddlewareNext<Input, Output>;
}) => AgentEffectResult<Output>;
```

`next` always returns `Promise<Output>`. Middleware itself returns
`AgentEffectResult<Output>`, so it can return output directly, promise-like output,
or an `Effect`.

`callModel` middleware wraps model execution:

```ts
import type {
  AgentCallModelArgs,
  AgentCallModelResult,
  AgentMiddleware,
} from "@nanoagent/kernel";

type CallModelMiddleware<Context> = AgentMiddleware<
  AgentCallModelArgs<Context>,
  AgentCallModelResult
>;
```

`AgentCallModelArgs` carries prepared model `args`, `createdAt`, and `turn`.
`next(input)` runs provider resolution, `streamText`, result normalization, and
pending tool-call extraction. Return `AgentCallModelResult` with final `args`,
`duration`, `rawResult`, canonical model `result`, and `pendingToolCalls`.

`callTool` middleware wraps accepted tool execution:

```ts
import type {
  AgentCallToolArgs,
  AgentMiddleware,
  AgentToolCallResponse,
} from "@nanoagent/kernel";

type CallToolMiddleware<Context> = AgentMiddleware<
  AgentCallToolArgs<Context>,
  AgentToolCallResponse
>;
```

`AgentCallToolArgs` carries `context`, `messages`, optional `signal`, `toolCall`,
and registered `tools`.

## `next(input)`

Use `next` with current input to continue chain.

```ts
const traceModel: CallModelMiddleware<Context> = async ({ input, next }) => {
  const startedAt = performance.now();
  const output = await next(input);

  metrics.histogram("agent.model.duration_ms", performance.now() - startedAt, {
    model: input.args.model,
  });

  return output;
};
```

Use changed input to transform downstream operation.

```ts
const capTokens: CallModelMiddleware<Context> = ({ input, next }) =>
  next({
    ...input,
    args: {
      ...input.args,
      maxOutputTokens: Math.min(input.args.maxOutputTokens ?? 4096, 4096),
    },
  });
```

Return without `next` to replace operation.

```ts
const fixtureTools: CallToolMiddleware<Context> = ({ input, next }) => {
  if (process.env.NODE_ENV !== "test") return next(input);
  if (input.toolCall.toolName !== "ReadTicket") return next(input);

  return {
    toolCallId: input.toolCall.toolCallId,
    toolName: input.toolCall.toolName,
    input: input.toolCall.input,
    output: { id: "TICKET-123", status: "open" },
  };
};
```

## Retry

Retry middleware calls `next` again when output or thrown error is retryable.

```ts
const retryToolNetworkErrors: CallToolMiddleware<Context> = async ({
  input,
  next,
}) => {
  for (let attempt = 0; ; attempt++) {
    const output = await next(input);

    if (!("error" in output)) return output;
    if (!isTransientNetworkError(output.error) || attempt >= 2) return output;

    await sleep(250 * 2 ** attempt);
  }
};
```

Model retry can change model args between attempts:

```ts
const fallbackModel: CallModelMiddleware<Context> = async ({ input, next }) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await next({
        ...input,
        args: {
          ...input.args,
          model: attempt === 1 ? input.args.model : "anthropic/claude-opus-4-7",
        },
      });
    } catch (error) {
      if (!isRetryableProviderError(error) || attempt >= 2) throw error;
      await sleep(500);
    }
  }
};
```

Fallback target must exist in `modelProviders` because model string selects provider and model.

## Cache

Cache middleware returns stored result without calling `next`.

```ts
const cacheModel: CallModelMiddleware<Context> = async ({ input, next }) => {
  const key = await hashModelArgs(input.args);
  const cached = await modelCache.get(key);
  if (cached) return cached;

  const output = await next(input);
  await modelCache.set(key, output, { ttlSeconds: 60 });
  return output;
};
```

Cache only deterministic calls. Include `model`, messages, tool names, provider route, and tenant policy in key.

## Transform

Middleware can transform result before kernel writes it into run state.

```ts
const dropDebugToolCalls: CallModelMiddleware<Context> = async ({
  input,
  next,
}) => {
  const output = await next(input);

  return {
    ...output,
    pendingToolCalls: output.pendingToolCalls.filter(
      (toolCall) => toolCall.toolName !== "DebugOnlyTool",
    ),
  };
};
```

Use hooks when phase state should show policy decision. Use middleware when execution boundary should be wrapped or result should be replaced.

## Register

Pass middleware arrays to `runAgent`.

```ts
for await (const event of runAgent<Context>({
  state,
  tools,
  modelProviders,
  hooks,
  maxTurns: 20,
  saveState,
  middleware: {
    callModel: [traceModel, fallbackModel, cacheModel],
    callTool: [retryToolNetworkErrors, fixtureTools],
  },
})) {
  streamToClient(event);
}
```

Array order is outer to inner. In example, `traceModel` measures total time spent inside fallback and cache.
