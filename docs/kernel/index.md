# @nanoagent/kernel

`@nanoagent/kernel` is durable runtime for LLM agent runs.

`runAgent` advances one state machine through turn preparation, model call, tool execution, turn completion, pause, resume, completion, and failure. Each committed transition writes serializable `AgentRunState` and yields stream events. Caller code owns memory, prompts, tools, storage, providers, auth, approvals, UI, and observability.

## Problem

Agent runs fail at process boundaries.

Connection drops, workers restart, users approve tools hours later, model providers return partial streams, and tool processes crash after external side effects. Reliable systems need exact run state, committed at each phase, with enough information to resume from persisted state instead of reconstructing run from transcript fragments.

`@nanoagent/kernel` gives caller code one state-machine boundary for that problem:

- `runAgent` async generator for execution and streaming.
- `AgentRunState` snapshots with `status`, `currentTurn`, and `turns`.
- Pause and resume through persisted run state.
- Hook contracts for phase decisions and observation.
- Middleware around model and tool I/O boundaries.
- Provider resolution for `<provider>/<model-name>` model strings.
- Tool execution checkpoints that separate pending, in-flight, and completed calls.

## Ownership Boundary

Kernel owns behavior that must stay consistent across products:

- Run loop and phase order.
- Run state shape, status, and revision counter.
- Commit ordering for state and events.
- Hook invocation points.
- Middleware composition.
- Model provider resolution.
- Model and tool execution boundaries.
- Tool call snapshots.
- Stream event emission.
- Cancellation and terminal states.

Caller code owns product decisions:

- Conversation memory and prompt assembly.
- Model routing and provider construction.
- Tool catalog and tool policy.
- Persistence store and transaction semantics.
- Human approval workflows.
- Retry, fallback, cache, and sandbox rules.
- Metrics, logs, traces, and UI delivery.

## Scenarios

Use `@nanoagent/kernel` when run correctness depends on durable state:

- Resume run in later process after worker crash.
- Pause for human approval before executing sensitive tool.
- Persist each phase to database, object store, queue, file, or durable object.
- Route models per turn by tenant, cost, complexity, or capability.
- Wrap model calls with retry, timeout, cache, or routing middleware.
- Wrap tool execution with policy, fixtures, sandboxing, or idempotency middleware.
- Stream model parts to UI while state transitions remain persisted.
- Stop through caller-controlled finish conditions or `maxTurns`.

## API Shape

```ts
runAgent({
  state,
  tools,
  modelProviders,
  hooks,
  saveState,
  maxTurns,
  middleware,
  signal,
});
```

`runAgent` returns `AsyncGenerator<AgentStreamEvent>`. Nothing executes until caller iterates generator.

`state` is either fresh `{ context, runId? }` input or full persisted `AgentRunState`. `tools`, `modelProviders`, `hooks`, `saveState`, `middleware`, and `signal` are process-local runtime values.

`saveState` receives committed state plus `AgentPhaseEvent[]`. `stream_part` events are yielded live with `createdAt` and are not persisted through `saveState`.

## Run State

`AgentRunState` is durable execution snapshot:

```ts
type AgentRunState<Context> = {
  runId: string;
  revision: number;
  status: AgentRunStatus;
  context: Context;
  turns: Turn[];
  currentTurn?: Turn;
  updatedAt: string;
};
```

`status` records lifecycle:

- `running`: live run at one phase.
- `paused`: resumable run stopped at one phase.
- `completed`: terminal success from caller, model completion, or `maxTurns`.
- `failed`: terminal failure with serialized error.

`currentTurn` holds active turn. `turns` holds completed turns. Turn snapshots carry model args, model result, and tool call snapshots:

- `pending`: tool calls accepted for execution or still awaiting per-call hook.
- `inFlight`: tool calls launched at execution boundary.
- `completed`: tool call outputs or recorded tool errors.

## Phases

Live phases are named checkpoints:

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

Terminal outcomes live on `status`, not phase. `revision` increments at committed snapshots.

## Hooks

Hooks are phase contracts. `onTurnPrepared` is required because caller owns model input assembly. Other hooks observe or decide phase behavior.

Hooks receive cloned, read-only args. They may return:

- `context`: replacement JSON context for next snapshot.
- `value`: phase-specific decision, such as model args, rewritten tool calls, or skipped tool response.
- `control`: `pause`, `finish`, or `continue`.

`onPause`, `onModelRestarted`, and `onStreamUpdate` are observation hooks and do not return control.

## Boundaries

Model boundary resolves `model` string through provider registry, strips tool `execute` functions before `streamText`, streams `fullStream` as timestamped `stream_part` events, and commits canonical `AgentModelResult` after model completion. `callModel` middleware wraps committed model result boundary.

Tool boundary executes accepted tool calls through original `ToolSet`. Tool throws and rejections become `AgentToolCallResponse` errors. They do not fail run by themselves. `callTool` middleware wraps each accepted tool execution.

Middleware composes in array order. First middleware wraps later middleware and terminal operation. Middleware can call `next` zero times, once, or many times.

## Pause And Resume

Hooks pause by returning `control: { type: "pause" }`. Kernel snapshots paused status at current phase, emits `pause`, and exits generator.

Resume passes saved `AgentRunState` back to `runAgent`. No resume flag exists. Kernel transitions paused state back to running at same phase and continues.

Resume from `model_started` restarts model call and emits `model_restarted`. Resume from `tool_call_completed` requires empty `inFlight`; kernel fails if tool side effects may still be ambiguous.

## Doc Map

- [Quickstart](./quickstart.md): minimal end-to-end run.
- [Run state](./state-run.md): durable state, status, phases, turns, and resume behavior.
- [Session state](./state-session.md): caller-owned continuity across runs.
- [Hooks](./hooks.md): phase contracts for routing, prompt assembly, approval gates, and pause/finish decisions.
- [Middleware](./middleware.md): wrappers around model and tool boundaries for retry, cache, timeout, fixture, and policy.
- [Models](./models.md): model selection at `onTurnPrepared` and `<provider>/<model-name>` resolution.
- [Tools](./tools.md): durable tool-call phase state and caller-owned tool policy.
- [API](./api.md): `runAgent` options, stream events, and exported types.
- [Examples](./examples.md): separate packages for common integration patterns.
