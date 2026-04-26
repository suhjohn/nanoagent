# Tools

Tool execution is durable turn state plus caller-owned policy.

Caller injects tools by passing Vercel AI SDK `ToolSet` to `runAgent`.

```ts
import { jsonSchema, tool, type ToolSet } from "ai";
import { runAgent } from "@nanoagent/kernel";

type Context = {
  root: string;
  tenantId: string;
};

const tools = {
  ReadFile: tool({
    description: "Read UTF-8 file content.",
    inputSchema: jsonSchema<{
      path: string;
    }>({
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    }),
    execute: async ({ path }, options) => {
      const context = options.experimental_context as Context;
      return await readProjectFile({ root: context.root, path });
    },
  }),
} satisfies ToolSet;

for await (const event of runAgent<Context>({
  state,
  tools,
  hooks,
  maxTurns: 20,
  saveState,
})) {
  await streamToClient(event);
}
```

`tools` is process-local runtime input. Persist `AgentRunState`, then recreate `tools` when resuming run in another process.

Kernel uses injected tools in two ways:

- Model receives tool definitions with `execute` stripped, so only names, descriptions, schemas, and provider-facing metadata reach model boundary.
- Tool execution uses original `ToolSet`, finds `tools[toolName].execute`, and calls it for accepted tool calls.

Caller does not return tools from `onTurnPrepared`. `onTurnPrepared` returns model input such as `model`, `messages`, and generation options. Kernel injects current `tools` into model call and records `toolNames: Object.keys(tools)` on committed `state.currentTurn.modelArgs`.

Tool `execute` receives model-provided input and runtime metadata:

```ts
execute(toolCall.input, {
  toolCallId: toolCall.toolCallId,
  messages,
  abortSignal: signal,
  experimental_context: context,
});
```

`experimental_context` is current durable `AgentRunState.context`. Use it for tenant, session, approval, policy, and idempotency data that must survive resume.

Kernel tracks current turn tool calls in `state.currentTurn.toolCalls`:

- `pending`: accepted calls waiting to launch.
- `inFlight`: launched calls without persisted result.
- `completed`: calls with persisted output or error.

## Lifecycle

Model result creates pending calls.

```txt
model_completed
  currentTurn.toolCalls.pending = model tool calls
  currentTurn.toolCalls.inFlight = []
  currentTurn.toolCalls.completed = []
```

`onToolCallsStarted` can rewrite batch before per-call policy runs.

```ts
const hooks: AgentHooks<Context> = {
  onToolCallsStarted: ({ toolCalls }) => ({
    value: toolCalls.filter((call) => call.toolName !== "DebugOnlyTool"),
  }),
};
```

`onToolCallStarted` runs once per pending call. It can allow call, rewrite call, skip call, pause, finish, or update context.

```ts
const hooks: AgentHooks<Context> = {
  onToolCallStarted: ({ toolCallId, toolName, input }) => {
    if (toolName === "DeleteAccount") {
      return {
        value: {
          type: "skip",
          result: {
            toolCallId,
            toolName,
            input,
            error: "blocked by policy",
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

Skip result is normalized onto original `toolCallId` and `toolName`. Rewrites keep rewritten call. Pause keeps current call pending and exits before launch.

After all accepted calls are prepared, kernel moves pending calls to `inFlight`, clears `pending`, executes calls, then records each result as `tool_call_completed`.

## Non-Idempotent Default

Tools are non-idempotent by default.

If process dies after tool launch and before all results persist, current turn may contain `inFlight` calls. Kernel refuses to replay those calls automatically:

```txt
Cannot safely resume while tool calls are in flight.
```

Caller code may replay only when tool owner makes external operation idempotent and rewrites saved state before `runAgent`.

```ts
function replaySafeTools<Context>(
  state: AgentRunState<Context>,
): AgentRunState<Context> {
  if (state.status.type !== "running" && state.status.type !== "paused") {
    return state;
  }

  const currentTurn = state.currentTurn;
  if (state.status.phase !== "tool_call_completed") return state;
  if (!currentTurn?.toolCalls.inFlight.length) return state;

  return {
    ...state,
    status: {
      ...state.status,
      phase: "tool_call_started",
    },
    currentTurn: {
      ...currentTurn,
      toolCalls: {
        pending: currentTurn.toolCalls.inFlight,
        inFlight: [],
        completed: currentTurn.toolCalls.completed,
      },
    },
  };
}
```

Use stable `toolCallId` as external idempotency key before moving in-flight calls back to pending.

## `onToolCallStarted` Policy

Use hook for phase decision because it runs before execution state launches tools.

Common policy:

- Pause for human approval.
- Skip blocked tool calls.
- Rewrite arguments for sandboxing.
- Attach context updates.
- Finish run because product condition is satisfied.

```ts
const hooks: AgentHooks<Context> = {
  onToolCallStarted: ({ context, toolCallId, toolName, input }) => {
    if (toolName === "ChargeCard" && !context.approved.includes(toolCallId)) {
      return {
        control: {
          type: "pause",
          reason: "approval_required",
          metadata: { toolCallId, toolName },
        },
      };
    }

    if (toolName === "SendEmail" && context.readonly) {
      return {
        value: {
          type: "skip",
          result: { toolCallId, toolName, input, error: "readonly run" },
        },
      };
    }
  },
};
```

## `callTool` Middleware

Use `callTool` middleware for execution wrapper around accepted call.

Middleware receives `toolCall`, `tools`, `messages`, `context`, optional `signal`, and `next`. It can call `next` zero times, once, or many times.

```ts
const retryWebFetch: AgentMiddleware<
  AgentCallToolArgs<Context>,
  AgentToolCallResponse
> = async ({ input, next }) => {
  for (let attempt = 0; ; attempt++) {
    const result = await next(input);

    if (!("error" in result)) return result;
    if (!isTransientNetworkError(result.error) || attempt >= 2) return result;

    await sleep(250 * 2 ** attempt);
  }
};

await consume(
  runAgent<Context>({
    state,
    tools,
    hooks,
    maxTurns: 20,
    saveState,
    middleware: {
      callTool: [retryWebFetch],
    },
  }),
);
```

Use middleware for retry, fixture response, caching, tracing, timeout, auth envelope, or tool-specific execution metrics.

## Skip, Rewrite, Retry

Pick boundary by concern:

- Skip before execution: return `{ value: { type: "skip", result } }` from `onToolCallStarted`.
- Rewrite before execution: return rewritten `AgentToolCall` from `onToolCallStarted`.
- Retry execution: call `next(input)` again from `callTool` middleware when result is retryable.
- Replace execution: return `AgentToolCallResponse` from middleware without calling `next`.

Hook policy affects run state. Middleware policy affects execution result.

## Sibling Independence

Prepared tool calls run concurrently.

Each tool response becomes independent `tool_call_completed` event and is removed from `inFlight` by `toolCallId`. One tool response can be an error while siblings succeed.

Kernel stores every response in `completed`. Caller code decides whether sibling error should stop future turns, retry whole batch, ask for human input, or let model observe mixed tool results.
