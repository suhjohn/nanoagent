# Q&A

## Why not use Vercel AI SDK `ToolLoopAgent`?

Use `ToolLoopAgent` when you want convenient agent object around
`generateText` and `streamText`: model, tools, instructions, `prepareStep`,
`stopWhen`, final result, and streaming result.

Use kernel when you need durable execution surface:

- Persist phase state before events are observed.
- Resume paused, failed, or crashed runs.
- Load messages from caller storage every turn.
- Gate full tool batch before any tool runs.
- Gate individual tool calls with exact arguments.
- Stream raw model parts and durable phase events through same iterator.

Kernel still uses Vercel AI SDK model/tool primitives. It extracts loop
sequencing around them.

## Why not use Claude Code SDK, Codex CLI, OpenCode, or DeepAgents directly?

Those projects are full products or higher-level frameworks. They choose session
storage, runtime shape, permission mode, event protocol, plugin surface,
compaction behavior, and UI assumptions.

Kernel is for teams that keep rewriting same core loop because product semantics
do not fit one harness. It gives you phase sequencing, tool/model boundaries,
streaming events, pause/resume, and revisioned state. Everything around that
loop stays caller-owned.

## Can I keep run state in Postgres but transcripts or artifacts in S3?

Yes. `saveState` receives JSON-shaped `AgentRunState` and commit-local
`AgentPhaseEvent[]`. Persist that wherever you want.

Common layout:

- Postgres: latest run snapshot keyed by `runId`.
- Postgres or ClickHouse: append-only phase events keyed by `(runId, revision)`.
- S3/R2/GCS: bulky transcripts, traces, model payloads, files, screenshots.
- `state.context`: stable keys that point to those external records.

Kernel only needs valid snapshot passed back as `state` on resume.

## Where do messages live?

Caller owns messages.

`state.turns` records what happened in kernel terms: model args, canonical model
result, pending/in-flight/completed tool calls. Kernel does not automatically
reconstruct next model input from prior turns.

`onTurnPrepared` is the message boundary:

```ts
const hooks: AgentHooks<Context> = {
  onTurnPrepared: async ({ context, state }) => ({
    value: {
      model: context.model,
      messages: await messageStore.load({
        threadId: context.threadId,
        turns: state.turns,
      }),
    },
  }),
};
```

That store can be database rows, S3 objects, compacted summaries, inbox messages,
retrieval chunks, or a plain in-memory array for tests.

## How do I experiment with compaction?

Compact outside kernel, then return compacted messages from `onTurnPrepared`.

Examples:

- Keep recent messages and summarize older turns.
- Keep tool results verbatim but drop intermediate reasoning.
- Build retrieval chunks from old transcript history.
- Compact only when token estimate crosses budget.
- Store original artifacts in S3 and compacted prompt state in Postgres.

Kernel records execution. Caller decides what future model calls see.

## How do I build inbox or event-driven wake?

Store queued user messages outside kernel, usually keyed by session or thread.
When worker starts or resumes run, `onTurnPrepared` drains or reads that inbox and
builds model messages for current turn.

If product needs a waiting run, return `control: { type: "pause" }` from any
hook. External webhook, queue consumer, SSE event, file watcher, or user action
can later load saved state and call `runAgent` again.

Kernel does not own wake mechanism. It preserves exact phase to resume.

## Can permission policy see all tool calls before any tool runs?

Yes. Use `onToolCallsStarted`.

That hook receives full pending tool call list for turn. It can approve, reorder,
rewrite, drop, or pause before any tool execution starts.

Use this for aggregate policy:

- Tool calls are safe alone but unsafe together.
- Total cost is too high.
- Certain tools require approval only after seeing combined plan.
- Batch should run in different order.

## Can permission policy inspect one tool call with arguments?

Yes. Use `onToolCallStarted`.

That hook runs per accepted call with `toolName`, `toolCallId`, `input`, and
full `toolCall`. It can rewrite call, skip execution with synthetic result, or
pause for approval.

```ts
const hooks: AgentHooks<Context> = {
  onToolCallStarted: ({ toolCallId, toolName, input }) => {
    if (toolName === "deleteFile" && isProtectedPath(input)) {
      return {
        value: {
          type: "skip",
          result: {
            toolCallId,
            toolName,
            input,
            output: { blocked: true, reason: "protected_path" },
          },
        },
      };
    }
  },
};
```

Kernel writes skipped call as completed tool response, so model receives explicit
result instead of hidden denial.

See `examples/skip-protected-tool/src/cli.ts`.

## How do I avoid rejected tool calls causing retry loops?

Return clear synthetic tool result when rejecting. Models often interpret generic
tool errors as transient failures and retry same call.

Prefer result that says policy decision is final:

```ts
output: {
  blocked: true,
  policy: "requires_human_approval",
  retryable: false,
}
```

For human approval, pause before execution. Resume with context updated to mark
approval, then allow same call or return rejection result.

## What happens if process crashes?

Load latest committed `AgentRunState` and pass it back to `runAgent`.

Kernel resumes from `state.status.phase`. If crash happened after durable commit
but before event reached UI, caller may replay events from event log or continue
from snapshot. `revision` lets storage reject stale writes and order projections.

## What happens if model provider fails mid-run?

If provider fails after `model_started`, kernel commits `status: failed` with
`phase: "model_started"` and serialized error. Passing same snapshot back retries
model call and emits `model_restarted`.

This makes provider failures explicit and resumable.

## What happens to in-flight tool calls on resume?

Kernel does not pretend in-flight external side effects are safe to replay.

If state says tool calls are still `inFlight`, resume from
`tool_call_completed` throws. Product code should reconcile external side effect
state, write completed tool responses, or restart run from safer earlier state.

Accepted tool calls run in parallel. Each completion commits independently.

## Are streamed model parts persisted?

No. `stream_part` events are live stream events yielded by `runAgent` while model
runs. They do not appear in `saveState.events`.

Kernel commits canonical `AgentModelResult` at `model_completed`. Persist
`stream_part` yourself if UI replay or raw stream audit matters.

## How do I stream tool-call requests while they are still forming?

Read `stream_part` events from `runAgent`.

Those events contain raw Vercel AI SDK `TextStreamPart`, including text deltas,
tool-call deltas, reasoning, warnings, and finish information. Forward them to
SSE, WebSocket, CLI, trace store, or UI projection.

Durable phase events still commit through `saveState`.

## What should `saveState` guarantee?

`saveState` should make latest state durable before caller observes matching
phase event.

Recommended guarantees:

- State and events commit atomically when storage supports it.
- Writes reject stale `revision`.
- Event inserts are idempotent by `(runId, revision, type, createdAt)` or stricter local key.
- Latest state keyed by `runId` can be loaded to resume.

If `saveState` throws, run fails. Durability failure should not be hidden.

## What if I do not want to snapshot at every phase?

`saveState` is called at every durable phase boundary, but it is your function.
You can append every event and write latest state only on selected phases.

Inside `saveState`, current phase is in `state.status`:

```ts
const saveState: AgentSaveState<Context> = async ({ state, events }) => {
  const phase =
    state.status.type === "running" || state.status.type === "paused"
      ? state.status.phase
      : state.status.type;

  console.log({ phase, revision: state.revision, events: events.map((e) => e.type) });
};
```

For live phases, `state.status.phase` is the phase just committed:
`turn_prepared`, `model_started`, `model_completed`, `tool_call_completed`, and
so on. For terminal states, `state.status.type` is `completed` or `failed`.
`events` is commit-local and usually contains matching phase event for same
revision.

Resume works from latest state you actually persisted. Any committed work after
that checkpoint is outside resume snapshot unless you can rebuild it from your
event log or external store. That creates a replay window.

Use sparse checkpoints only when replay is acceptable or separately guarded:

- Safe to replay: prompt preparation, pure validation, idempotent reads.
- Usually checkpoint: before model call, after model result, after each
  non-idempotent tool result, pause, failure, completion.
- Risky to skip: external writes, purchases, file mutations, deploys, or tool
  calls without idempotency keys.

Pattern:

```ts
const saveState: AgentSaveState<Context> = async ({ state, events }) => {
  await eventLog.append(events);

  if (!shouldCheckpoint({ state, events })) {
    return;
  }

  await snapshotStore.put(state);
};
```

If process exits after a skipped phase, load latest saved snapshot and call
`runAgent` again. Kernel resumes from that older phase. If your event log has
newer events, caller can either accept replay, reconcile external side effects,
or rebuild a newer `AgentRunState` before resuming.

See `examples/sparse-checkpoints/src/cli.ts`.

## How do I avoid unbounded checkpoint growth?

Keep kernel state focused on execution. Store large payloads outside state and
put stable keys in `context`.

For message growth, compact in caller storage and return compacted prompt from
`onTurnPrepared`. For artifact growth, store raw traces, files, and large model
payloads in blob storage. For event growth, append events to log storage and keep
only latest snapshot for resume.

Kernel does not impose one checkpointing strategy.

## How do hooks differ from middleware?

Hooks make phase decisions and update durable context. Use hooks to prepare model
input, approve tools, pause, finish, continue, or record compact product facts.

Middleware wraps I/O. Use middleware for tracing, retry, caching, sandboxing,
fixtures, request signing, rate limiting, or provider/tool instrumentation.

Hooks see execution state. Middleware sees call boundary.

## What happens if hook throws?

Run fails. Kernel serializes error into `status: failed` at recoverable phase,
emits `run_failed`, then rethrows to caller iterator.

If failure is transient, fix cause and pass saved snapshot back to `runAgent`.

## Can I use this in CLI, serverless, worker, or CI?

Yes. `runAgent` is async generator. Runtime is caller-owned.

Use it in:

- CLI loop writing events to stdout.
- HTTP handler streaming SSE.
- WebSocket session.
- Queue worker.
- Durable Object.
- CI job.
- Unit test with in-memory `saveState`.

Kernel does not own process model.

## What happens when model finish reason is not `tool-calls`?

Kernel completes current turn, then completes run as `model_done` unless caller explicitly continues.

Model result becomes `state.currentTurn.modelResult`. Tool snapshot is empty:

```ts
toolCalls: {
  pending: [],
  inFlight: [],
  completed: [],
}
```

Main loop sees `model_completed` with no pending tool calls and calls `completeTurn`.

After `turn_completed`, loop checks:

- `maxTurns`: complete run as `max_turns`.
- `onTurnCompleted` returned `control: { type: "continue" }`: start next turn.
- no completed tool calls: complete run as `model_done`.

So plain model completion ends run by default. Use `onTurnCompleted` with `continue` when product wants another turn after non-tool response.

```ts
const hooks: AgentHooks<Context> = {
  onTurnCompleted: ({ turn }) => {
    if (shouldRunAnotherTurn(turn)) {
      return {
        control: {
          type: "continue",
        },
      };
    }
  },
};
```

## Why are `tools` top-level instead of returned from `onTurnPrepared`?

`tools` contain runtime functions. Kernel state is durable JSON-shaped execution
state, so it records tool definitions indirectly through model-visible schemas,
tool calls, and tool results. It does not try to persist executable closures,
process handles, clients, sandboxes, or other runtime values.

Keeping `tools` at top level keeps boundary clear:

- `state` captures where run is and what happened.
- `context` carries caller-owned durable JSON.
- `onTurnPrepared` returns model input for current turn.
- `tools` provides process-local executors kernel may call during that run.

This also leaves representation of runtime functions open. Callers can recreate
tools per process, wrap them with middleware, inject clients, or swap toolsets
for tests without changing committed `AgentRunState`.
