# State

State is durable snapshot of one `runAgent` execution.

It answers one question: if this process exits now, what must be loaded so
kernel can continue from same phase without guessing?

`state` is not product memory, session model, tool registry, provider config, UI
state, or database adapter. Those stay caller-owned. Kernel owns execution
position, committed turns, current in-progress turn, revision, and terminal
outcome.

## Shape

Fresh run input can be just caller context:

```ts
runAgent({
  state: {
    context: {
      userId: "user_123",
      threadId: "thread_456",
      model: "openai/gpt-5.5",
    },
  },
  // ...
});
```

Kernel expands it into `AgentRunState<Context>`:

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

Resume input is complete `AgentRunState<Context>` loaded from storage:

```ts
const saved = await store.load(runId);

for await (const event of runAgent({
  state: saved,
  hooks,
  tools,
  maxTurns: 20,
  saveState: store.commit,
})) {
  await publish(event);
}
```

Kernel clones supplied state before use. Hook args receive cloned, deeply frozen
state so hook code cannot mutate committed snapshot by accident.

## Fields

`runId` identifies one durable execution. Caller may provide it for fresh runs;
kernel generates one when omitted.

`revision` increments on every committed snapshot. `saveState` receives state and
events with same revision, so storage can reject stale writes and project ordered
event logs.

`status` records live phase or terminal outcome:

```ts
type AgentRunStatus =
  | { type: "running"; phase: AgentPhase }
  | { type: "paused"; phase: AgentPhase; reason?: string; metadata?: JsonLike; createdAt: string }
  | { type: "completed"; source: "caller" | "model_done" | "max_turns"; reason?: string; metadata?: JsonLike; createdAt: string }
  | { type: "failed"; phase: AgentPhase; error: SerializedError; createdAt: string };
```

`context` is caller-owned durable JSON. Use it for compact facts later hooks need:
tenant, user, thread, routing choice, approval ids, budgets, counters, or storage
keys. Do not put clients, functions, open handles, model objects, tool executors,
or cache instances in context.

`turns` is completed turn history. Each completed turn contains model args, model
result, and tool call snapshot.

`currentTurn` exists while turn is in progress. It is removed when turn commits
to `turns`.

`updatedAt` marks latest committed snapshot time.

## Turns

Turn is one model step plus optional tools:

```ts
type Turn = {
  turnId: string;
  turn: number;
  modelArgs?: AgentModelArgs;
  modelResult?: AgentModelResult;
  toolCalls: {
    pending: AgentToolCall[];
    inFlight: AgentToolCall[];
    completed: AgentToolCallResponse[];
  };
};
```

Kernel fills turn progressively:

```txt
turn_started       currentTurn created
turn_prepared      modelArgs recorded
model_completed    modelResult recorded, pending tool calls extracted
tool_calls_started pending calls reviewed as batch
tool_call_started  accepted calls staged
tool_call_completed completed responses appended
turn_completed     currentTurn moves into turns[]
```

`turns` is durable execution record. It is not automatically reassembled into
future model messages. `onTurnPrepared` decides what messages to load every turn:
from `state.turns`, remote transcript storage, inbox queue, database row, S3
object, or any product-owned source.

## Commits

Kernel commits state through `saveState` before yielding durable phase events:

```ts
type AgentSaveState<Context extends JsonLike> = (args: {
  state: AgentRunState<Context>;
  events: AgentPhaseEvent[];
}) => AgentEffectResult<void>;
```

`events` is commit-local. It contains phase events for current revision only, not
full event history. Persist state and events atomically when storage supports it:

```ts
const saveState = async ({ state, events }) => {
  await db.transaction(async (tx) => {
    await tx.insertEvents(events.map((event) => ({
      runId: state.runId,
      revision: state.revision,
      payload: event,
    })));

    await tx.upsertRunState({
      runId: state.runId,
      revision: state.revision,
      state,
    });
  });
};
```

Storing latest `state` is enough to resume. Storing `events` adds audit log,
replay, UI feeds, metrics, and debugging projections.

`stream_part` events are live model stream events. They are yielded from
`runAgent`, but they are not `AgentPhaseEvent` values and do not appear in
`saveState.events`. Kernel commits final model output at `model_completed`.

## Resume

Paused and failed snapshots are resumable because status stores phase:

```ts
if (state.status.type === "paused" || state.status.type === "failed") {
  // runAgent flips status to running at same phase and continues.
}
```

Important resume rules:

- `paused` resumes from stored phase.
- `failed` resumes from failed phase.
- `completed` has no live phase, so no more work runs.
- `model_started` resumes by re-running model call and streaming
  `model_restarted`.
- `tool_call_completed` resumes only when `inFlight` is empty.
- In-flight tool calls are not safely resumable because external side effects may
  already have started.

## State Versus Context

State is kernel-owned envelope. Context is caller-owned JSON inside envelope.

Use state to inspect execution: current phase, turn number, completed tool
responses, prior model results, revision, pause or failure metadata.

Use context to carry product facts needed by future hooks:

```ts
type Context = {
  userId: string;
  threadId: string;
  messageStoreKey: string;
  model: string;
  approvedToolCallIds: string[];
};
```

Hooks update context by returning replacement context:

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

Kernel applies returned context to next snapshot. Keep context small and
serializable. Put large transcripts, artifacts, embeddings, files, traces, and
product session records in caller storage, then store keys in context.

## What State Is Not

State does not decide prompt assembly. `onTurnPrepared` does.

State does not own session semantics. Caller decides whether many runs belong to
one session, one run spans one request, or one inbox drives many runs.

State does not persist executable runtime values. `tools`, `modelProviders`,
`middleware`, `saveState`, and `signal` are process-local options recreated for
each `runAgent` call.

State does not force single storage backend. Save compact run snapshots in
Postgres, event logs in ClickHouse, artifacts in S3, and remote messages wherever
product needs them. Kernel only needs caller to pass a valid snapshot back.
