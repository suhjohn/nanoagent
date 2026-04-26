# Run-level state: Pause, Finish, Cancel, Resume

Run state is kernel-owned execution state for one `runAgent` invocation.

`AgentRunState` records current lifecycle position, caller `context`, completed turns, in-progress turn, revision, and timestamp. It is durable snapshot used to observe, persist, pause, resume, complete, or fail one run.

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

`context` is caller-owned durable JSON. Kernel passes it through hooks and persists updates, but never interprets domain fields.

## Status

`status` describes run lifecycle:

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

`running` means run is live at specific `AgentPhase`.

`paused` means run stopped intentionally at specific phase. `reason`, `metadata`, and `createdAt` come from pause control value.

`completed` means run reached terminal success. `source` is:

```ts
type AgentCompletionSource = "caller" | "model_done" | "max_turns";
```

`caller` means hook returned `finish`. `model_done` means completed turn had no tool results and no `continue` request. `max_turns` means turn cap ended run.

`failed` means non-cancel error reached run boundary. Kernel stores serialized error details, emits `run_failed`, then rethrows original error.

Cancel is not `AgentRunStatus`. `AbortSignal` cancellation throws and skips `onRunFailed`, `run_failed`, and failed snapshot.

## Phases

`AgentPhase` names resumable checkpoints inside live run:

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

`running` and `paused` carry phase. Terminal statuses do not.

`run_started` is fresh run checkpoint before first turn.

`turn_started` creates `currentTurn` with `turnId`, one-based `turn`, and empty tool snapshot.

`turn_prepared` stores model input returned by `onTurnPrepared` in `currentTurn.modelArgs`.

`model_started` records model-call boundary. Resume from this phase restarts model call and emits `model_restarted`.

`model_completed` stores canonical `AgentModelResult` and model tool calls in `currentTurn.toolCalls.pending`.

`tool_calls_started` stores tool-call list after `onToolCallsStarted`.

`tool_call_started` stores accepted or skipped per-tool decisions. Accepted calls stay in `pending` until execution launches them.

`tool_call_completed` records one completed tool response. Resume from this phase requires empty `inFlight`; otherwise kernel fails because tool side effects are ambiguous.

`tool_calls_completed` records all tool calls complete.

`turn_completed` moves completed turn into `turns` and clears `currentTurn`.

## Turns

`currentTurn` is active work. `turns` contains completed turns.

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

`modelArgs` appears after `turn_prepared`. Resume from `turn_prepared` or `model_started` uses committed model args and does not rerun `onTurnPrepared`.

`modelResult` appears after `model_completed`.

`toolCalls.pending` contains model-requested calls before preparation, accepted calls before launch, or calls still awaiting preparation after pause.

`toolCalls.inFlight` contains launched calls whose results have not committed. Kernel refuses resume from `tool_call_completed` if this list is non-empty.

`toolCalls.completed` contains executed or skipped call responses.

Completed turns in `state.turns` have `modelArgs`, `modelResult`, empty `pending`, and empty `inFlight`.

## Control Values

Hooks can return control values to stop current run loop intentionally:

```ts
return {
  control: {
    type: "pause",
    reason: "waiting_for_approval",
    metadata: { approvalId },
  },
};
```

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

`pause` snapshots paused status, emits `pause`, calls `onPause`, and exits generator.

`finish` schedules clean completion with `source: "caller"`. Kernel completes at next checkpoint, emits `run_completed`, and records `reason` and `metadata` on completed status.

`continue` requests another turn after current turn completes. `maxTurns` still caps loop.

`onStreamUpdate`, `onModelRestarted`, and `onPause` cannot return control. `onRunCompleted` ignores `finish` and `continue` because completion is already in progress, but still honors `pause`.

## Pause And Resume

Resume passes saved `AgentRunState` back to `runAgent`. No resume flag exists.

If status is `paused`, kernel first snapshots same phase as `running`, then continues from that phase.

Resume from `model_started` restarts model call and emits `model_restarted`. This event has no `revision` because persisted phase is still `model_started`.

Resume from `turn_prepared` runs model using saved `modelArgs`.

Resume from `model_completed` either completes turn when no pending tool calls exist or enters tool-call preparation.

Resume from `tool_calls_started` reruns per-tool preparation for current `pending` calls.

Resume from `tool_call_started` launches accepted `pending` calls. Snapshot moves them to `inFlight` before execution.

Resume from `tool_call_completed` continues only when `inFlight` is empty, then completes tool-call group. Non-empty `inFlight` fails run.

Resume from `tool_calls_completed` completes turn.

Resume from `turn_completed` starts next turn, completes as `model_done`, or completes as `max_turns`.

## Failure And Cancel

Non-cancel errors call `onRunFailed`, allow context update, snapshot `status.type === "failed"`, emit `run_failed`, and rethrow original error.

Abort cancellation comes from `signal`. Kernel checks signal before run start, at loop checkpoints, while consuming model stream, and while committing tool results. Abort throws directly. It does not call `onRunFailed`, write failed state, or emit `run_failed`.

## Contrast With Session State

Run state answers: where is this one run in kernel execution right now?

Session state answers: what should caller-owned application remember across runs?
