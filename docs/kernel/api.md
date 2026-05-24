# API Reference

`@nanoagent/kernel` exports one runtime function: `runAgent`.

`runAgent` advances one durable `AgentRunState` state machine. Caller supplies
serializable state plus process-local runtime values. Kernel yields typed events
as `AsyncGenerator<AgentStreamEvent, void, void>`.

```ts
import { runAgent } from "@nanoagent/kernel";

for await (const event of runAgent<Context>({
  state,
  hooks,
  tools,
  modelProviders,
  middleware,
  saveState,
  signal,
  maxTurns: 20,
})) {
  await emit(event);
}
```

```ts
function runAgent<Context extends JsonLike>(
  options: RunAgentOptions<Context>,
): AsyncGenerator<AgentStreamEvent, void, void>;
```

Iteration starts execution. Constructing generator does not run hooks, call
model, execute tools, or save state.

## Runtime Boundary

`RunAgentOptions` combines durable input with process-local runtime services.
Persist `state`. Recreate everything else per process.

```ts
type RunAgentOptions<Context extends JsonLike> = AgentRuntime<Context> & {
  maxTurns: number;
  hooks: AgentHooks<Context>;
  saveState?: AgentSaveState<Context>;
  middleware?: AgentMiddlewareMap<Context>;
  signal?: AbortSignal;
};

type AgentRuntime<Context extends JsonLike> = {
  state: AgentRunState<Context> | { context: Context; runId?: string };
  tools?: ToolSet;
  modelProviders?: AgentModelProviders;
};
```

Runtime value ownership:

- `state`: durable state machine input.
- `state.context`: caller-owned durable JSON.
- `hooks`: phase decisions and observation.
- `tools`: process-local executable tool registry.
- `modelProviders`: process-local provider registry.
- `middleware`: process-local wrappers around model/tool boundaries.
- `saveState`: commit callback for durable snapshots.
- `signal`: process-local cancellation channel.

## Option: `state`

Fresh run input:

```ts
type FreshAgentRunState<Context extends JsonLike> = {
  runId?: string;
  context: Context;
};
```

Fresh run initialization:

```ts
{
  runId: state.runId ?? randomUUID(),
  revision: 0,
  status: { type: "running", phase: "run_started" },
  context: state.context,
  turns: [],
  updatedAt: nowIso(),
}
```

Resume input is complete `AgentRunState<Context>`. Kernel clones it before use.

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

Resume behavior:

- `paused` resumes by committing same phase with `status.type = "running"`.
- `failed` resumes by committing failed phase with `status.type = "running"`.
- `completed` has no live phase; runtime exits without new work.
- `model_started` resumes by re-running model call and yielding
  `model_restarted`.
- `tool_call_completed` resumes only when `inFlight` is empty.
- In-flight tool calls are not resumable because external side effects are
  ambiguous.

## Option: `tools`

```ts
tools?: ToolSet;
```

Default: `{}`.

`tools` is Vercel AI SDK `ToolSet`. Kernel uses same object at two boundaries:

1. Model call receives tool definitions with `execute` stripped. Raw JSON schemas
   are wrapped with `jsonSchema`.
2. Tool execution looks up `tools[toolName].execute` for accepted calls.

Tool executor call shape:

```ts
execute(toolCall.input, {
  toolCallId: toolCall.toolCallId,
  messages,
  abortSignal: signal,
  experimental_context: context,
});
```

Tool result rules:

- Missing `execute` fails tool execution and records error response.
- Thrown/rejected tool error becomes `AgentToolCallResponse` with `error`.
- Async iterable output is consumed; final yielded chunk becomes `output`.
- Tool errors do not fail run unless middleware throws outside response shape.

## Option: `modelProviders`

```ts
type AgentModelProviders = Record<
  string,
  (modelName: string) => ReturnType<typeof openai>
>;
```

Model strings use provider prefix:

```txt
<provider>/<model-name>
```

Resolution:

1. Split string on first `/`.
2. Trim/lowercase provider.
3. Trim model name.
4. Look up provider in merged provider registry.
5. Call provider factory with model name.

Custom providers are normalized with `trim().toLowerCase()` and override built-in
providers by key.

Built-in provider keys:

```txt
openai
anthropic
azure
baseten
cerebras
cohere
deepinfra
deepseek
fireworks
google
gemini
google-interactions
gemini-interactions
vertex
google-vertex
groq
grok
mistral
perplexity
together
togetherai
bedrock
amazon-bedrock
vercel
xai
```

`google` and `gemini` use Google provider `generateContent`. `google-interactions`
and `gemini-interactions` use Google provider `google.interactions(...)` for
Gemini Interactions API models.

Invalid model strings and unsupported providers fail run.

## Option: `maxTurns`

```ts
maxTurns: number;
```

Kernel checks `maxTurns` after `turn_completed`. If last completed turn number
is greater than or equal to `maxTurns`, run completes:

```ts
{
  type: "completed",
  source: "max_turns",
  metadata: { maxTurns },
  createdAt,
}
```

`control: { type: "continue" }` cannot bypass `maxTurns`.

## Option: `hooks`

```ts
hooks: AgentHooks<Context>;
```

Hooks are phase contracts. `onTurnPrepared` is required. All other hooks are
optional.

Hook return values may be sync, Promise-like, or Effect:

```ts
type AgentEffectResult<A, E extends Error = Error> =
  | MaybePromiseLike<A>
  | Effect.Effect<A, E, never>;
```

Hook args use cloned read-only state:

```ts
type BaseHookArgs<Context extends JsonLike> = {
  context: ReadonlyDeep<Context>;
  state: ReadonlyDeep<AgentRunState<Context>>;
  runId: string;
};
```

Kernel clones and deep-freezes normal JSON-shaped data before hook delivery.
Return new `context`; do not mutate args.

## Option: `saveState`

```ts
type AgentSaveState<Context extends JsonLike> = (args: {
  state: AgentRunState<Context>;
  events: AgentPhaseEvent[];
}) => AgentEffectResult<void>;
```

Commit algorithm:

1. Build next snapshot.
2. Increment `revision`.
3. Set `updatedAt`.
4. Patch `revision` on events that carry one.
5. Clone snapshot.
6. Call `saveState({ state, events })`.
7. Replace in-memory snapshot with committed state.
8. Yield committed events.

`stream_part` events are not passed to `saveState`. Empty event arrays are valid;
kernel uses them for state-only commits, including resume and context-only hook
updates.

If `saveState` fails, kernel calls `onRunFailed`, commits failed state, yields
`run_failed`, then rethrows original error. Abort errors skip failure conversion.

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

type AgentMiddlewareNext<Input, Output> = (input: Input) => Promise<Output>;

type AgentMiddleware<Input, Output> = (args: {
  input: Input;
  next: AgentMiddlewareNext<Input, Output>;
}) => AgentEffectResult<Output>;
```

Composition uses array order. First middleware wraps later middleware and
terminal operation.

Middleware may:

- Return without `next` to replace operation.
- Call `next` once to observe or transform operation.
- Call `next` multiple times for retry/fallback policy.
- Throw to fail run.

## Option: `signal`

```ts
signal?: AbortSignal;
```

Abort checkpoints:

- before run starts
- each main loop iteration
- during model stream consumption
- before each tool result commit

Abort throws. It does not call `onRunFailed`, does not commit failed state, and
does not yield `run_failed`.

## State Types

```ts
type JsonPrimitive = string | number | boolean | null;

type JsonLike =
  | JsonPrimitive
  | { readonly [key: string]: JsonLike }
  | readonly JsonLike[];

type ReadonlyDeep<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly ReadonlyDeep<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
      : T;
```

`Context`, pause metadata, and finish metadata must be `JsonLike`.

```ts
type SerializedError = {
  message: string;
  name?: string;
  stack?: string;
};
```

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
  | {
      type: "failed";
      phase: AgentPhase;
      error: SerializedError;
      createdAt: string;
    };

type AgentCompletionSource = "caller" | "model_done" | "max_turns";

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

Status invariants:

- `running.phase` and `paused.phase` identify resumable checkpoint.
- `failed.phase` identifies recovery checkpoint.
- `completed` is terminal and has no phase.
- `revision` increments on every committed snapshot.
- `updatedAt` is ISO timestamp for latest committed snapshot.

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

Turn invariants:

- `turn` is one-based.
- `turnId` is UUID.
- `modelArgs` exists after `turn_prepared`.
- `modelResult` exists after `model_completed`.
- Completed turns move from `currentTurn` to `turns`.
- Completed turns have empty `pending` and empty `inFlight`.

Tool-call queues:

- `pending`: accepted/prepared calls not launched.
- `inFlight`: launched calls awaiting result commit.
- `completed`: executed or skipped call responses.

## Model Types

```ts
type AgentStreamTextOptions = DistributiveOmit<
  Parameters<typeof streamText<ToolSet>>[0],
  "model" | "tools" | "abortSignal"
>;

type AgentTurnPreparedValue = AgentStreamTextOptions & {
  model: string;
};
```

`onTurnPrepared` returns `AgentTurnPreparedValue`. Kernel owns `model` resolution,
model-visible `tools`, and `abortSignal`. Other fields pass through to
`streamText`.

```ts
type AgentModelArgs = AgentStreamTextOptions & {
  model: string;
  toolNames: string[];
};
```

`AgentModelArgs` is committed prepared input. `toolNames` is
`Object.keys(tools)` at preparation time.

```ts
type AgentResponse = LanguageModelResponseMetadata & {
  messages: Array<AssistantModelMessage | ToolModelMessage>;
};

type AgentRawModelResult = ReturnType<typeof streamText>;

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

`AgentModelResult` is committed model output. Kernel awaits and stores stable
fields from `streamText`.

`AgentRawModelResult` is available to `onModelCompleted` and `callModel`
middleware. It is not cloned or deep-frozen. Use it for SDK-shaped fields kernel
does not normalize, such as `toolCalls`, `toolResults`, `steps`, and `files`.

## Tool Types

```ts
type AgentToolCall = ToolCall<string, unknown>;
type ReadonlyAgentToolCall = ReadonlyDeep<AgentToolCall>;
```

Tool input is `unknown` because it crosses model/schema boundary.

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

```ts
type AgentToolCallsStartedValue = readonly AgentToolCall[];

type AgentToolCallStartedValue =
  | AgentToolCall
  | {
      type: "skip";
      result: AgentToolCallResponse;
    };
```

`onToolCallsStarted` may replace batch. `onToolCallStarted` may replace one call
or skip execution by returning final response.

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

Control semantics:

- `pause`: commit paused status and exit generator.
- `finish`: schedule clean completion with `source: "caller"`.
- `continue`: start another turn after current turn completes.

Observation-only hooks cannot return control: `onStreamUpdate`,
`onModelRestarted`, `onPause`.

`onRunCompleted` may pause. `finish` and `continue` are ignored because
completion is already in progress.

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

Return-field semantics:

- `context`: replaces `state.context`.
- `value`: supplies phase-specific output.
- `control`: changes run flow.

Context updates are committed immediately for hooks that run after a phase event
already committed. For hooks that precede a phase commit, context rides with
next phase snapshot.

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

Hook arg additions:

| Type | Added fields |
| --- | --- |
| `AgentRunStartedArgs` | `createdAt` |
| `AgentTurnStartedArgs` | `createdAt`, `turn` |
| `AgentTurnPreparedArgs` | `createdAt`, `turn` |
| `AgentModelStartedArgs` | `args`, `createdAt`, `turn` |
| `AgentModelRestartedArgs` | `createdAt`, `turn` |
| `AgentModelCompletedArgs` | `args`, `createdAt`, `duration`, `result`, `rawResult`, `turn` |
| `AgentStreamUpdateArgs` | `createdAt`, `part`, `turn` |
| `AgentToolCallsStartedArgs` | `createdAt`, `result`, `toolCalls`, `turn` |
| `AgentToolCallStartedArgs` | `createdAt`, `toolCall`, `toolCallId`, `toolName`, `input`, `turn` |
| `AgentToolCallCompletedArgs` | `createdAt`, `duration`, `toolCallId`, `toolName`, `input`, `turn`, plus `output` or `error` |
| `AgentToolCallsCompletedArgs` | `createdAt`, `result`, `toolCalls`, `turn` |
| `AgentTurnCompletedArgs` | `createdAt`, `duration`, `turn` |
| `AgentRunCompletedArgs` | `createdAt`, `duration`, `turns` |
| `AgentRunFailedArgs` | `createdAt`, `error` |
| `AgentPauseArgs` | `createdAt`, `phase`, `turn?`, `reason?`, `metadata?` |

## Middleware Boundary Types

```ts
type AgentCallModelArgs<Context extends JsonLike> = BaseHookArgs<Context> & {
  args: AgentModelArgs;
  createdAt: string;
  turn: Turn;
};

type AgentCallModelResult = {
  args: AgentModelArgs;
  duration: number;
  pendingToolCalls: AgentToolCall[];
  rawResult: AgentRawModelResult;
  result: AgentModelResult;
};
```

`callModel` wraps provider execution before `model_completed` commit. Middleware
may change model args, cache result, retry, or replace `pendingToolCalls`.

```ts
type AgentCallToolArgs<Context extends JsonLike> = {
  context: Context;
  messages: ModelMessage[];
  signal?: AbortSignal;
  toolCall: AgentToolCall;
  tools: ToolSet;
};
```

`callTool` wraps accepted tool execution. It must return
`AgentToolCallResponse`.

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

type AgentStreamPartEvent = Extract<
  AgentStreamEvent,
  { type: "stream_part" }
>;
```

Event persistence:

- `AgentPhaseEvent` is passed to `saveState` and yielded.
- `stream_part` is yielded live after `onStreamUpdate`.
- `stream_part` is never passed to `saveState`.
- Events with `revision` receive committed snapshot revision.
- `model_restarted` has no `revision` because it observes resume from existing
  `model_started` checkpoint.

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
      phase: AgentPhase;
      error: SerializedError;
    };
```

`createdAt` and `updatedAt` are ISO strings. `duration` is milliseconds.

## Phase Machine

Nominal transition graph:

```txt
run_started
  -> turn_started
  -> turn_prepared
  -> model_started
  -> model_completed
  -> tool_calls_started?      when pending tool calls exist
  -> tool_call_started?       after batch/per-call hook filtering
  -> tool_call_completed*     one event per executed tool result
  -> tool_calls_completed?    when tool calls were present
  -> turn_completed
  -> run_started equivalent   next turn
```

Turn completion branching:

1. If `turn >= maxTurns`, complete with `source: "max_turns"`.
2. Else if hook requested `continue`, start next turn.
3. Else if completed turn has no tool results, complete with
   `source: "model_done"`.
4. Else start next turn.

Pause can happen from any hook that returns control. Finish can be requested
from any control-capable hook. Abort can happen at abort checkpoints.

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
