# Hooks

Hooks are phase contracts.

Each hook runs in process, receives typed read-only args, and returns typed decisions. Use hooks for product policy that changes run state: prompt assembly, routing, approval gates, tool rewrites, context updates, pause, finish, and continue.

## Phase Contract

Kernel advances through named phases:

```txt
run_started
turn_started
turn_prepared
model_started
model_completed
tool_calls_started
tool_call_started
tool_call_completed
tool_calls_completed
turn_completed
```

Terminal outcomes are `status.type === "completed"` and `status.type === "failed"`. They aren't phases.

Hook names mirror phases:

```ts
import type { AgentHooks } from "@nanoagent/kernel";

const hooks: AgentHooks<Context> = {
  onRunStarted: ({ runId }) => {
    console.log(`run started: ${runId}`);
  },
  onTurnPrepared: async ({ context }) => ({
    value: {
      model: context.model,
      messages: await messageStore.load(context.threadId),
    },
  }),
  onToolCallStarted: ({ toolName }) => {
    if (toolName === "DeleteAccount") {
      return { control: { type: "pause", reason: "approval_required" } };
    }
  },
  onTurnCompleted: ({ turn }) => {
    console.log(`turn ${turn.turn} completed`);
  },
};
```

`onTurnPrepared` is required. It returns exact model input for current turn.

## Base Envelope

Every hook receives base fields:

```ts
type BaseHookArgs<Context extends JsonLike> = {
  context: ReadonlyDeep<Context>;
  state: ReadonlyDeep<AgentRunState<Context>>;
  runId: string;
};
```

Turn-scoped hooks add `turn: Turn`. Phase hooks add fields for their boundary: `createdAt`, `duration`, `args`, `result`, `rawResult`, `toolCall`, `toolCallId`, `toolName`, `input`, `output`, `error`, `toolCalls`, or `turns`.

`onStreamUpdate` receives `createdAt` for streamed part. Corresponding `stream_part` event uses same timestamp.

`AgentRunState<Context>` has fixed turn and model result types. It is not generic over model result:

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

`AgentModelResult` is canonical model output kernel commits to durable state:

```ts
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

`onModelCompleted` carries `rawResult: ReturnType<typeof streamText>`: un-normalized Vercel AI SDK return. Use `rawResult` for SDK-shaped fields kernel does not commit to `AgentModelResult`, such as `toolCalls`, `toolResults`, `steps`, and `files`. `rawResult` is not cloned or deep-frozen; do not mutate it.

Use phase fields instead of reading deep state when field exists. `state` is there for whole-run decisions.

## Immutability

Hook base `context` and `state` come from cloned, deeply frozen state snapshot. Boundary payloads are cloned where kernel needs isolation. `rawResult` is direct SDK object and is never cloned or frozen.

Do not mutate `context`, `state`, `toolCall`, `result`, or arrays inside hook args. Return next value:

```ts
const hooks: AgentHooks<Context> = {
  onToolCallCompleted: ({ context, toolCallId }) => ({
    context: {
      ...context,
      approvedToolCallIds: context.approvedToolCallIds.filter(
        (id) => id !== toolCallId,
      ),
    },
  }),
};
```

Kernel applies returned `context` to next run state. Keep it JSON-shaped. Runtime handles, providers, clients, file descriptors, and functions belong outside `context`.

## Return Shape

Hooks return `void`, `Promise`, `Effect`, or object, depending on hook:

```ts
type HookResult<Value, Context> = void | {
  context?: Context;
  value?: Value;
  control?:
    | { type: "pause"; reason?: string; metadata?: JsonLike }
    | { type: "finish"; reason?: string; metadata?: JsonLike }
    | { type: "continue" };
};
```

`context` replaces caller-owned state in run state.

`value` supplies phase-specific value. Examples:

- `onTurnPrepared`: model args.
- `onToolCallsStarted`: rewritten batch of tool calls.
- `onToolCallStarted`: rewritten tool call or skip result.

`control` changes run flow. Hooks can pause, finish, or request another turn. `maxTurns` still caps continuation.

Some hooks are observation-only and return `void` through `Promise` or `Effect`:

```ts
type ObservationHook = (
  args: Args,
) => void | Promise<void> | Effect.Effect<void, Error, never>;
```

`onPause`, `onModelRestarted`, and `onStreamUpdate` cannot update `context`, return `value`, or return `control`.

`onPause` fires after paused snapshot is committed and before pause event yields. `onModelRestarted` fires after resumed run commits back to `model_started` and before `model_restarted` event yields. `onStreamUpdate` fires for each streamed part before corresponding `stream_part` event yields.

## Context Updates

Use `context` for compact durable facts needed by later hooks:

```ts
type Context = {
  userId: string;
  threadId: string;
  model: string;
  toolErrors: number;
};

const hooks: AgentHooks<Context> = {
  onToolCallCompleted: ({ context, error }) => {
    if (!error) return;

    return {
      context: {
        ...context,
        toolErrors: context.toolErrors + 1,
      },
    };
  },
};
```

Context updates are not side effects. Kernel persists them with phase state.

## Value Returns

`onTurnPrepared` returns model input:

```ts
const hooks: AgentHooks<Context> = {
  onTurnPrepared: async ({ context, turn }) => ({
    value: {
      model: turn.turn === 1 ? "anthropic/claude-opus-4-7" : context.model,
      messages: [
        { role: "system", content: "Answer with concise engineering detail." },
        ...(await messageStore.load(context.threadId)),
      ],
    },
  }),
};
```

Kernel stores returned value in `state.currentTurn.modelArgs`. Resume from `turn_prepared` or `model_started` uses committed value and does not rerun `onTurnPrepared`.

`onToolCallStarted` can rewrite or skip one call:

```ts
const hooks: AgentHooks<Context> = {
  onToolCallStarted: ({ toolCallId, toolName, input }) => {
    if (toolName === "SendEmail" && isReadonlyRun()) {
      return {
        value: {
          type: "skip",
          result: {
            toolCallId,
            toolName,
            input,
            error: "readonly run",
          },
        },
      };
    }

    if (toolName === "Bash") {
      if (!isBashInput(input)) throw new Error("invalid Bash input");

      return {
        value: {
          toolCallId,
          toolName,
          input: {
            ...input,
            command: sandboxCommand(input.command),
          },
        },
      };
    }
  },
};
```

Skip result is recorded as completed tool response. Rewritten call becomes pending execution.

## Control Returns

Pause persists current run position and exits generator:

```ts
const hooks: AgentHooks<Context> = {
  onToolCallStarted: ({ context, toolCallId, toolName }) => {
    if (toolName !== "ChargeCard") return;
    if (context.approvedToolCallIds.includes(toolCallId)) return;

    return {
      control: {
        type: "pause",
        reason: "approval_required",
        metadata: { toolCallId, toolName },
      },
    };
  },
};
```

Resume by loading saved `AgentRunState`, updating caller-owned `context`, and calling `runAgent` again.

Finish records caller completion:

```ts
const hooks: AgentHooks<Context> = {
  onTurnCompleted: ({ turn }) => {
    if (turn.modelResult?.finishReason !== "stop") return;

    return {
      control: {
        type: "finish",
        reason: "answer_complete",
        metadata: { turnId: turn.turnId },
      },
    };
  },
};
```

Kernel transitions `status` to `{ type: "completed", source: "caller", ... }`.

## Failure Hook

`onRunFailed` runs when kernel catches an error that is not caller cancellation. It can attach final context before `status` transitions to `failed`:

```ts
const hooks: AgentHooks<Context> = {
  onRunFailed: ({ context, error }) => ({
    context: {
      ...context,
      lastError:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) },
    },
  }),
};
```

Cancellation through `signal` skips `onRunFailed` and skips the failure state write.

## Hook List

`AgentHooks<Context>` supports:

- `onRunStarted`
- `onTurnStarted`
- `onTurnPrepared`
- `onModelStarted`
- `onModelRestarted`
- `onModelCompleted`
- `onPause`
- `onStreamUpdate`
- `onToolCallsStarted`
- `onToolCallStarted`
- `onToolCallCompleted`
- `onToolCallsCompleted`
- `onTurnCompleted`
- `onRunCompleted`
- `onRunFailed`

See [API](./api.md) for type signatures and [Tools](./tools.md) for tool policy.
