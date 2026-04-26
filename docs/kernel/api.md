# API

`runAgent` is kernel runtime entry point.

It takes one options object and returns `AsyncGenerator<AgentStreamEvent>`. Work starts when caller iterates generator.

## `runAgent`

```ts
import { runAgent } from "@nanoagent/kernel";

for await (const event of runAgent<Context>({
  state,
  tools,
  modelProviders,
  hooks,
  maxTurns: 20,
  saveState,
  middleware,
  signal,
})) {
  await streamToClient(event);
}
```

```ts
function runAgent<Context extends JsonLike>(
  options: RunAgentOptions<Context>,
): AsyncGenerator<AgentStreamEvent, void, void>;
```

`Context` must be JSON-shaped because kernel commits it into durable run state.

## `RunAgentOptions`

```ts
type RunAgentOptions<Context extends JsonLike> = AgentRuntime<Context> & {
  maxTurns: number;
  hooks: AgentHooks<Context>;
  saveState?: AgentSaveState<Context>;
  middleware?: AgentMiddlewareMap<Context>;
  signal?: AbortSignal;
};
```

`RunAgentOptions` combines durable input (`state`) with process-local runtime values (`tools`, `modelProviders`, `hooks`, `saveState`, `middleware`, `signal`). Persist only `state`; recreate all other options per process.

## Option: `state`

```ts
type AgentRuntime<Context extends JsonLike> = {
  state: AgentRunState<Context> | { context: Context; runId?: string };
  tools?: ToolSet;
  modelProviders?: AgentModelProviders;
};
```

Fresh run uses compact state:

```ts
runAgent({
  state: {
    runId: "run_123",
    context: { threadId: "thread_123", model: "openai/gpt-5" },
  },
  // ...
});
```

If `runId` is omitted, kernel generates UUID. Fresh run starts at revision `0`, status `{ type: "running", phase: "run_started" }`, empty `turns`, and no `currentTurn`.

Resumed run passes full `AgentRunState<Context>`:

```ts
runAgent({
  state: savedRunState,
  hooks,
  tools,
  modelProviders,
  maxTurns: 20,
});
```

If resumed state is paused, kernel first transitions it back to running at same phase and snapshots that change. Resuming from `model_started` restarts model call and emits `model_restarted`. Resuming from `tool_call_completed` is allowed only when no tool calls are still in flight. In-flight tool resume fails because kernel cannot know whether external tool side effects already happened.

## Option: `tools`

```ts
tools?: ToolSet;
```

`tools` is Vercel AI SDK `ToolSet`. Default is `{}`.

Kernel uses tools in two different ways:

- Model call receives tool definitions with `execute` stripped, so model sees callable schemas without executable functions.
- Tool execution receives original `ToolSet`, finds `tools[toolName].execute`, and calls it for accepted tool calls.

Tool `execute` receives:

```ts
execute(toolCall.input, {
  toolCallId: toolCall.toolCallId,
  messages,
  abortSignal: signal,
  experimental_context: context,
});
```

If tool output is async iterable, kernel consumes it and stores final yielded chunk as output. If tool execution throws or rejects, kernel records `AgentToolCallResponse` with `error`; run continues through normal tool completion.

## Option: `modelProviders`

```ts
type AgentModelProviders = Record<
  string,
  (modelName: string) => ReturnType<typeof openai>
>;
```

`modelProviders` maps provider name to Vercel AI SDK model factory. Custom providers are trimmed, lowercased, and merged over built-in providers.

Model strings use:

```txt
<provider>/<model-name>
```

Examples:

```txt
openai/gpt-5
anthropic/claude-opus-4-7
google/gemini-3.1-pro
```

Kernel splits on first slash. Provider name is lowercased. Remainder becomes `modelName` passed to provider factory, so model names may contain slashes.

Built-in provider keys include `openai`, `anthropic`, `azure`, `baseten`, `cerebras`, `cohere`, `deepinfra`, `deepseek`, `fireworks`, `google`, `gemini`, `vertex`, `google-vertex`, `groq`, `grok`, `mistral`, `perplexity`, `together`, `togetherai`, `bedrock`, `amazon-bedrock`, `vercel`, and `xai`.

Invalid model strings or unsupported providers fail run with `run_failed`, unless caller abort signal caused failure.

## Option: `maxTurns`

```ts
maxTurns: number;
```

`maxTurns` is checked after each completed turn. If last completed turn number is greater than or equal to `maxTurns`, kernel completes run with:

```ts
{
  type: "completed",
  source: "max_turns",
  metadata: { maxTurns },
  createdAt,
}
```

`continue` control still respects `maxTurns`.

## Option: `hooks`

```ts
hooks: AgentHooks<Context>;
```

Hooks are phase contracts. `onTurnPrepared` is required because caller owns model input assembly. Other hooks are optional.

Hooks may return synchronously, as Promise-like values, or as Effect values:

```ts
type AgentEffectResult<A, E extends Error = Error> =
  | MaybePromiseLike<A>
  | Effect.Effect<A, E, never>;
```

Hook base `context` and `state` are cloned and deeply frozen before delivery. Boundary payloads are cloned where kernel needs isolation. Mutating hook args is invalid; return `context`, `value`, or `control`.

## Option: `saveState`

```ts
type AgentSaveState<Context extends JsonLike> = (args: {
  state: AgentRunState<Context>;
  events: AgentPhaseEvent[];
}) => AgentEffectResult<void>;
```

`saveState` runs at durable state boundaries. Kernel increments `revision`, updates `updatedAt`, patches event `revision` fields to match committed state, clones state, then calls `saveState`.

`events` contains only `AgentPhaseEvent[]`. `stream_part` events are yielded live with `createdAt` and are not passed to `saveState`.

Empty event arrays are valid. Kernel uses them for state-only snapshots, such as context updates from hooks that do not emit phase event.

If `saveState` fails, run fails. Kernel then calls `onRunFailed`, snapshots failed state, yields `run_failed`, and rethrows original error. Abort skips this failure conversion.

## Option: `middleware`

```ts
type AgentMiddlewareMap<Context extends JsonLike> = {
  callModel?: Array<
    AgentMiddleware<AgentCallModelArgs<Context>, AgentCallModelResult>
  >;
  callTool?: Array<
    AgentMiddleware<AgentCallToolArgs<Context>, AgentToolCallResponse>
  >;
};
```

Middleware wraps model and tool boundaries. Arrays compose in order: first middleware wraps later middleware and terminal operation.

```ts
type AgentMiddlewareNext<Input, Output> = (input: Input) => Promise<Output>;

type AgentMiddleware<Input, Output> = (args: {
  input: Input;
  next: AgentMiddlewareNext<Input, Output>;
}) => AgentEffectResult<Output>;
```

Middleware may call `next` zero times, once, or many times. Return without `next` to replace operation. Call `next` with changed input to transform downstream operation. Call `next` more than once for retry or fallback policy.

## Option: `signal`

```ts
signal?: AbortSignal;
```

`signal` cancels run from caller code. Kernel checks abort before run starts, at loop checkpoints, during model stream consumption, and while committing tool results.

Abort throws. It does not call `onRunFailed`, does not write failed state, and does not emit `run_failed`.

## JSON Types

```ts
type JsonPrimitive = string | number | boolean | null;

type JsonLike =
  | JsonPrimitive
  | { readonly [key: string]: JsonLike }
  | readonly JsonLike[];
```

`Context`, pause metadata, and finish metadata must be `JsonLike`. Persisted run state contains those JSON fields plus kernel-owned model and tool payloads.

```ts
type ReadonlyDeep<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly ReadonlyDeep<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
      : T;
```

Hook args expose `context` and `state` as `ReadonlyDeep`. This is type-level contract plus runtime clone/freeze for normal JSON-shaped data.

```ts
type SerializedError = {
  message: string;
  name?: string;
  stack?: string;
};
```

Failed status and `run_failed` events use serialized errors because they are persisted.

## State Types

```ts
type AgentRunState<Context extends JsonLike> = {
  runId: string;
  revision: number;
  status: AgentRunStatus;
  context: Context;
  turns: Turn[];
  currentTurn?: Turn;
  updatedAt: string;
};
```

`revision` increments on each committed snapshot. `updatedAt` is ISO timestamp for latest snapshot.

`context` is caller-owned durable JSON. Kernel never interprets domain fields inside it.

`turns` contains completed turns. `currentTurn` contains active turn and is removed when turn completes.

```ts
type AgentRunStatus =
  | { type: "running"; phase: AgentPhase }
  | {
      type: "paused";
      phase: AgentPhase;
      reason?: string;
      metadata?: JsonLike;
      createdAt: string;
    }
  | {
      type: "completed";
      source: AgentCompletionSource;
      reason?: string;
      metadata?: JsonLike;
      createdAt: string;
    }
  | { type: "failed"; error: SerializedError; createdAt: string };
```

`running` and `paused` carry live phase. Terminal statuses carry outcome directly.

```ts
type AgentCompletionSource = "caller" | "model_done" | "max_turns";
```

`caller` means hook returned `finish`. `model_done` means completed turn had no tool results and no `continue` request. `max_turns` means turn cap ended run.

```ts
type AgentPhase =
  | "run_started"
  | "turn_started"
  | "turn_prepared"
  | "model_started"
  | "model_completed"
  | "tool_calls_started"
  | "tool_call_started"
  | "tool_call_completed"
  | "tool_calls_completed"
  | "turn_completed";
```

Phases are resumable checkpoints inside live run.

## Turn Types

```ts
type ToolCallsSnapshot = {
  pending: AgentToolCall[];
  inFlight: AgentToolCall[];
  completed: AgentToolCallResponse[];
};

type Turn = {
  turnId: string;
  turn: number;
  modelArgs?: AgentModelArgs;
  modelResult?: AgentModelResult;
  toolCalls: ToolCallsSnapshot;
};
```

`turn` is one-based turn number. `turnId` is UUID.

`modelArgs` appears after `turn_prepared`. `modelResult` appears after `model_completed`.

`toolCalls.pending` contains calls accepted for execution or still awaiting per-tool preparation. `toolCalls.inFlight` contains launched tool calls. `toolCalls.completed` contains responses from executed or skipped calls.

Completed turns in `state.turns` have `modelArgs`, `modelResult`, empty `pending`, and empty `inFlight`.

## Model Types

```ts
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

type AgentStreamTextOptions = DistributiveOmit<
  Parameters<typeof streamText<ToolSet>>[0],
  "model" | "tools" | "abortSignal"
>;
```

`AgentStreamTextOptions` is caller-controlled subset of Vercel AI SDK `streamText` options. Kernel owns `model`, `tools`, and `abortSignal`.

```ts
type AgentTurnPreparedValue = AgentStreamTextOptions & {
  model: string;
};
```

`onTurnPrepared` returns `AgentTurnPreparedValue`. `model` is provider-prefixed string. Other fields pass through to `streamText`.

```ts
type AgentModelArgs = AgentStreamTextOptions & {
  model: string;
  toolNames: string[];
};
```

`AgentModelArgs` is committed version of prepared model input. `toolNames` is derived from `Object.keys(tools)` and records tool registry visible for turn.

```ts
type AgentResponse = LanguageModelResponseMetadata & {
  messages: Array<AssistantModelMessage | ToolModelMessage>;
};

type AgentModelResult = {
  finishReason?: string;
  response: AgentResponse;
  totalUsage: LanguageModelUsage;
  text?: string;
  reasoning?: Awaited<AgentRawModelResult["reasoning"]>;
  reasoningText?: string;
  sources?: Awaited<AgentRawModelResult["sources"]>;
  warnings?: Awaited<AgentRawModelResult["warnings"]>;
  providerMetadata?: Awaited<AgentRawModelResult["providerMetadata"]>;
};
```

`AgentModelResult` is canonical durable model output. Kernel awaits and stores normalized text, reasoning, sources, warnings, provider metadata, response metadata, and usage.

```ts
type AgentRawModelResult = ReturnType<typeof streamText>;
```

`AgentRawModelResult` is un-normalized Vercel AI SDK return. It is available to `onModelCompleted` and `callModel` middleware as `rawResult`. It is not cloned or deeply frozen. Use it for SDK-shaped fields kernel does not normalize, such as `toolCalls`, `toolResults`, `steps`, and `files`.

## Tool Types

```ts
type AgentToolCall = ToolCall<string, unknown>;
type ReadonlyAgentToolCall = ReadonlyDeep<AgentToolCall>;
```

Tool call input is `unknown` because it comes from model/tool schema boundary. Use tool schema or middleware policy to validate domain-specific shape.

```ts
type AgentToolCallResponse =
  | {
      toolCallId: string;
      toolName: string;
      input: unknown;
      output: unknown;
      error?: never;
    }
  | {
      toolCallId: string;
      toolName: string;
      input: unknown;
      error: unknown;
      output?: never;
    };
```

Tool response is success or failure union. Kernel stores thrown tool errors as `error` response instead of failing whole run.

```ts
type AgentToolCallsStartedValue = readonly AgentToolCall[];

type AgentToolCallStartedValue =
  | AgentToolCall
  | {
      type: "skip";
      result: AgentToolCallResponse;
    };
```

`onToolCallsStarted` can rewrite batch. `onToolCallStarted` can rewrite one call or skip it by providing final response.

## Control Types

```ts
type AgentPause = {
  type: "pause";
  reason?: string;
  metadata?: JsonLike;
};

type AgentFinish = {
  type: "finish";
  reason?: string;
  metadata?: JsonLike;
};

type AgentContinue = {
  type: "continue";
};

type AgentControl = AgentPause | AgentFinish | AgentContinue;
```

`pause` snapshots paused status and exits generator. `finish` schedules clean run completion with source `caller`. `continue` requests another turn after current turn completes.

`onStreamUpdate`, `onModelRestarted`, and `onPause` cannot return control. `onRunCompleted` ignores `finish` and `continue` because completion is already in progress, but still honors `pause`.

## Hook Return Types

```ts
type AgentHookResult<Value, Context extends JsonLike> = void | {
  context?: Context;
  value?: Value;
  control?: AgentControl;
};

type AgentVoidHookResult<Context extends JsonLike> = void | {
  context?: Context;
  control?: AgentControl;
};
```

`context` replaces run state's context. `value` supplies phase-specific output. `control` changes run flow.

## Hook Types

```ts
type AgentHooks<Context extends JsonLike> = {
  onRunStarted?: (
    args: AgentRunStartedArgs<Context>,
  ) => AgentEffectResult<AgentVoidHookResult<Context>>;
  onTurnStarted?: (
    args: AgentTurnStartedArgs<Context>,
  ) => AgentEffectResult<AgentVoidHookResult<Context>>;
  onTurnPrepared: (
    args: AgentTurnPreparedArgs<Context>,
  ) => AgentEffectResult<AgentHookResult<AgentTurnPreparedValue, Context>>;
  onModelStarted?: (
    args: AgentModelStartedArgs<Context>,
  ) => AgentEffectResult<AgentVoidHookResult<Context>>;
  onModelRestarted?: (
    args: AgentModelRestartedArgs<Context>,
  ) => AgentEffectResult<void>;
  onModelCompleted?: (
    args: AgentModelCompletedArgs<Context>,
  ) => AgentEffectResult<AgentVoidHookResult<Context>>;
  onPause?: (args: AgentPauseArgs<Context>) => AgentEffectResult<void>;
  onStreamUpdate?: (
    args: AgentStreamUpdateArgs<Context>,
  ) => AgentEffectResult<void>;
  onToolCallsStarted?: (
    args: AgentToolCallsStartedArgs<Context>,
  ) => AgentEffectResult<AgentHookResult<AgentToolCallsStartedValue, Context>>;
  onToolCallStarted?: (
    args: AgentToolCallStartedArgs<Context>,
  ) => AgentEffectResult<AgentHookResult<AgentToolCallStartedValue, Context>>;
  onToolCallCompleted?: (
    args: AgentToolCallCompletedArgs<Context>,
  ) => AgentEffectResult<AgentVoidHookResult<Context>>;
  onToolCallsCompleted?: (
    args: AgentToolCallsCompletedArgs<Context>,
  ) => AgentEffectResult<AgentVoidHookResult<Context>>;
  onTurnCompleted?: (
    args: AgentTurnCompletedArgs<Context>,
  ) => AgentEffectResult<AgentVoidHookResult<Context>>;
  onRunCompleted?: (
    args: AgentRunCompletedArgs<Context>,
  ) => AgentEffectResult<AgentVoidHookResult<Context>>;
  onRunFailed?: (
    args: AgentRunFailedArgs<Context>,
  ) => AgentEffectResult<AgentVoidHookResult<Context>>;
};
```

Every hook receives base envelope:

```ts
type BaseHookArgs<Context extends JsonLike> = {
  context: ReadonlyDeep<Context>;
  state: ReadonlyDeep<AgentRunState<Context>>;
  runId: string;
};
```

Hook arg additions:

| Type                          | Added fields                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `AgentRunStartedArgs`         | `createdAt`                                                                                  |
| `AgentTurnStartedArgs`        | `createdAt`, `turn`                                                                          |
| `AgentTurnPreparedArgs`       | `createdAt`, `turn`                                                                          |
| `AgentModelStartedArgs`       | `args`, `createdAt`, `turn`                                                                  |
| `AgentModelRestartedArgs`     | `createdAt`, `turn`                                                                          |
| `AgentModelCompletedArgs`     | `args`, `createdAt`, `duration`, `result`, `rawResult`, `turn`                               |
| `AgentStreamUpdateArgs`       | `createdAt`, `part`, `turn`                                                                  |
| `AgentToolCallsStartedArgs`   | `createdAt`, `result`, `toolCalls`, `turn`                                                   |
| `AgentToolCallStartedArgs`    | `createdAt`, `toolCall`, `toolCallId`, `toolName`, `input`, `turn`                           |
| `AgentToolCallCompletedArgs`  | `createdAt`, `duration`, `toolCallId`, `toolName`, `input`, `turn`, plus `output` or `error` |
| `AgentToolCallsCompletedArgs` | `createdAt`, `result`, `toolCalls`, `turn`                                                   |
| `AgentTurnCompletedArgs`      | `createdAt`, `duration`, `turn`                                                              |
| `AgentRunCompletedArgs`       | `createdAt`, `duration`, `turns`                                                             |
| `AgentRunFailedArgs`          | `createdAt`, `error`                                                                         |
| `AgentPauseArgs`              | `createdAt`, `phase`, `turn?`, `reason?`, `metadata?`                                        |

## Middleware Boundary Types

```ts
type AgentCallModelArgs<Context extends JsonLike> =
  AgentModelCompletedArgs<Context> & {
    pendingToolCalls: AgentToolCall[];
  };

type AgentCallModelResult = {
  pendingToolCalls: AgentToolCall[];
  result: AgentModelResult;
};
```

`callModel` middleware receives canonical model result, raw SDK result, and pending tool calls before `model_completed` state write. It can replace result or filter/modify pending tool calls.

```ts
type AgentCallToolArgs<Context extends JsonLike> = {
  context: Context;
  messages: ModelMessage[];
  signal?: AbortSignal;
  toolCall: AgentToolCall;
  tools: ToolSet;
};
```

`callTool` middleware receives accepted tool call, current context, current model messages, abort signal, and full tool registry. It returns `AgentToolCallResponse`.

## Event Types

```ts
type AgentStreamEvent =
  | AgentPhaseEvent
  | {
      type: "stream_part";
      runId: string;
      turnId: string;
      turn: number;
      createdAt: string;
      part: TextStreamPart<ToolSet>;
    };
```

`runAgent` yields both persisted phase events and live stream parts. Persisted phase events also pass through `saveState`. `stream_part` events include `createdAt` and do not pass through `saveState`.

```ts
type AgentStreamPartEvent = Extract<AgentStreamEvent, { type: "stream_part" }>;
```

## Phase Event Types

```ts
type AgentPhaseEvent =
  | {
      type: "run_started";
      runId: string;
      revision: number;
      createdAt: string;
    }
  | {
      type:
        | "turn_started"
        | "turn_prepared"
        | "model_started"
        | "tool_calls_started"
        | "tool_call_started"
        | "tool_calls_completed";
      runId: string;
      revision: number;
      createdAt: string;
      turn: Turn;
    }
  | {
      type: "pause";
      runId: string;
      revision: number;
      createdAt: string;
      phase: AgentPhase;
      turn?: Turn;
      reason?: string;
      metadata?: JsonLike;
    }
  | {
      type: "model_restarted";
      runId: string;
      createdAt: string;
      turn: Turn;
    }
  | {
      type: "model_completed";
      runId: string;
      revision: number;
      createdAt: string;
      duration: number;
      args: AgentModelArgs;
      result: AgentModelResult;
      turn: Turn;
    }
  | {
      type: "tool_call_completed";
      runId: string;
      revision: number;
      createdAt: string;
      duration: number;
      turn: Turn;
      toolCallId: string;
      toolName: string;
      input: unknown;
      output?: unknown;
      error?: unknown;
    }
  | {
      type: "turn_completed";
      runId: string;
      revision: number;
      createdAt: string;
      duration: number;
      turn: Turn;
    }
  | {
      type: "run_completed";
      runId: string;
      revision: number;
      createdAt: string;
      duration: number;
      turns: Turn[];
      source: AgentCompletionSource;
      reason?: string;
      metadata?: JsonLike;
    }
  | {
      type: "run_failed";
      runId: string;
      revision: number;
      createdAt: string;
      error: SerializedError;
    };
```

`model_restarted` has no `revision` because it is observation event for resumed `model_started`, not new persisted phase.

`duration` is milliseconds. `createdAt` and `updatedAt` are ISO strings.

## Exported Types

Data:

- `JsonPrimitive`
- `JsonLike`
- `ReadonlyDeep`
- `SerializedError`

Runtime:

- `AgentRuntime`
- `RunAgentOptions`
- `AgentSaveState`
- `AgentEffectResult`

Model and tools:

- `AgentToolCall`
- `ReadonlyAgentToolCall`
- `AgentToolCallResponse`
- `AgentResponse`
- `AgentStreamTextOptions`
- `AgentModelArgs`
- `AgentModelResult`
- `AgentRawModelResult`
- `AgentModelProviders`
- `AgentTurnPreparedValue`
- `AgentToolCallsStartedValue`
- `AgentToolCallStartedValue`

State:

- `AgentPhase`
- `AgentCompletionSource`
- `AgentPause`
- `AgentFinish`
- `AgentContinue`
- `AgentControl`
- `AgentRunStatus`
- `ToolCallsSnapshot`
- `Turn`
- `AgentRunState`

Events:

- `AgentPhaseEvent`
- `AgentStreamEvent`
- `AgentStreamPartEvent`

Hooks:

- `AgentHooks`
- `AgentHookResult`
- `AgentVoidHookResult`
- `BaseHookArgs`
- `AgentRunStartedArgs`
- `AgentTurnStartedArgs`
- `AgentTurnPreparedArgs`
- `AgentModelStartedArgs`
- `AgentModelRestartedArgs`
- `AgentModelCompletedArgs`
- `AgentStreamUpdateArgs`
- `AgentToolCallsStartedArgs`
- `AgentToolCallStartedArgs`
- `AgentToolCallCompletedArgs`
- `AgentToolCallsCompletedArgs`
- `AgentTurnCompletedArgs`
- `AgentRunCompletedArgs`
- `AgentRunFailedArgs`
- `AgentPauseArgs`

Middleware:

- `AgentMiddlewareNext`
- `AgentMiddleware`
- `AgentMiddlewareMap`
- `AgentCallModelArgs`
- `AgentCallModelResult`
- `AgentCallToolArgs`
