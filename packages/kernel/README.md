# @nanoagent/kernel

Durable run loop for agent products.

Kernel owns sequencing, [phase state](../../docs/kernel/state-run.md),
[pause/resume](../../docs/kernel/state-run.md#pause-and-resume),
[model](../../docs/kernel/models.md) and [tool](../../docs/kernel/tools.md)
boundaries, streaming events, commit ordering,
[middleware](../../docs/kernel/middleware.md) composition, and
[cancellation](../../docs/kernel/state-run.md#failure-and-cancel). Caller owns
prompts, [memory](../../docs/kernel/state-session.md), storage, providers, auth,
sandboxing, UI, and product policy.

```sh
npm install @nanoagent/kernel
```

## Contract

[`runAgent`](../../docs/kernel/api.md#runagent) takes caller state plus
[phase hooks](../../docs/kernel/hooks.md). Nothing runs until caller iterates
returned async generator.

```ts
runAgent({
  state, // AgentRunState | { runId?, context }
  hooks, // phase decisions
  tools, // AI SDK ToolSet
  modelProviders, // optional provider registry
  saveState, // durable commit callback
  middleware, // model/tool I/O wrappers
  signal, // caller cancellation
  maxTurns
})
```

Every turn follows same shape:

1. `onTurnPrepared` returns exact model args.
2. Kernel calls model and streams events.
3. Kernel records tool calls, then runs tools.
4. Hooks can update `context`, pause, finish, skip tool calls, or rewrite tool
   calls.
5. `saveState` receives revisioned `AgentRunState` plus emitted events at each
   commit boundary.

[`AgentRunState`](../../docs/kernel/state-run.md) is durable truth. Persist it,
load it, pass it back to `runAgent`.

## Small Run

One hook supplies [model input](../../docs/kernel/models.md#per-turn-routing).
One callback [persists state](../../docs/kernel/api.md#option-savestate).
[Stream events](../../docs/kernel/api.md#event-types) go where product wants
them.

```ts
import type { ModelMessage } from 'ai'
import {
  type AgentRunState,
  type AgentStreamEvent,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  sessionId: string
}

type Store = {
  load(runId: string): Promise<AgentRunState<Context> | undefined>
  save(state: AgentRunState<Context>): Promise<void>
}

type Messages = {
  load(sessionId: string): Promise<ModelMessage[]>
  append(sessionId: string, messages: ModelMessage[]): Promise<void>
}

async function runChat(params: {
  emit(event: AgentStreamEvent): void
  messages: Messages
  runId: string
  store: Store
}) {
  const state = (await params.store.load(params.runId)) ?? {
    runId: params.runId,
    context: { sessionId: params.runId }
  }

  for await (const event of runAgent({
    state,
    hooks: {
      onTurnPrepared: async ({ context }) => ({
        value: {
          model: 'openai/gpt-5.5',
          messages: await params.messages.load(context.sessionId)
        }
      }),
      onTurnCompleted: async ({ context, turn }) => {
        if (!turn.modelResult) return

        await params.messages.append(
          context.sessionId,
          turn.modelResult.response.messages
        )

        if (turn.modelResult.finishReason === 'stop') {
          return { control: { type: 'finish', reason: 'model_done' } }
        }
      }
    },
    saveState: ({ state }) => params.store.save(state),
    maxTurns: 20
  })) {
    params.emit(event)
  }
}
```

Kernel does not own [transcript policy](../../docs/kernel/state-session.md).
[`onTurnPrepared`](../../docs/kernel/hooks.md#hook-list) returns literal prompt
for current turn. `onTurnCompleted` decides which model output enters caller
memory.

## Pause

Any hook can [pause](../../docs/kernel/state-run.md#pause-and-resume). Kernel
commits paused state and exits generator. Later process loads same state,
changes caller-owned [`context`](../../docs/kernel/hooks.md#context-updates),
and calls `runAgent` again.

```ts
import type { ModelMessage, ToolSet } from 'ai'
import {
  type AgentHooks,
  type AgentRunState,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  approvedToolCalls: string[]
  sessionId: string
}

type Store = {
  load(runId: string): Promise<AgentRunState<Context> | undefined>
  save(state: AgentRunState<Context>): Promise<void>
}

type Messages = {
  load(sessionId: string): Promise<ModelMessage[]>
}

function hooks(messages: Messages): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context }) => ({
      value: {
        model: 'anthropic/claude-opus-4-7',
        messages: await messages.load(context.sessionId)
      }
    }),
    onToolCallStarted: ({ context, toolCallId, toolName }) => {
      if (toolName !== 'ChargeCard') return
      if (context.approvedToolCalls.includes(toolCallId)) return

      return {
        control: {
          type: 'pause',
          reason: 'approval_required',
          metadata: { toolCallId, toolName }
        }
      }
    }
  }
}

async function processRun(params: {
  messages: Messages
  runId: string
  store: Store
  tools: ToolSet
}) {
  const state = (await params.store.load(params.runId)) ?? {
    runId: params.runId,
    context: { approvedToolCalls: [], sessionId: params.runId }
  }

  await Array.fromAsync(
    runAgent({
      state,
      tools: params.tools,
      hooks: hooks(params.messages),
      saveState: ({ state }) => params.store.save(state),
      maxTurns: 20
    })
  )
}

async function approveToolCall(params: {
  messages: Messages
  runId: string
  store: Store
  toolCallId: string
  tools: ToolSet
}) {
  const state = await params.store.load(params.runId)
  if (!state) throw new Error(`missing run: ${params.runId}`)

  await params.store.save({
    ...state,
    context: {
      ...state.context,
      approvedToolCalls: [...state.context.approvedToolCalls, params.toolCallId]
    }
  })

  await processRun(params)
}
```

Approval lives in `context` because product owns policy. Kernel only preserves
position: current phase, current turn,
[pending, in-flight, and completed tool calls](../../docs/kernel/tools.md#lifecycle),
and prior turns.

## Tool Boundary

[Hooks](../../docs/kernel/hooks.md) decide per-call policy.
[Middleware](../../docs/kernel/middleware.md) wraps actual execution.

```ts
import type { ModelMessage, ToolSet } from 'ai'
import {
  type AgentCallToolArgs,
  type AgentHooks,
  type AgentMiddleware,
  type AgentToolCallResponse,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  sessionId: string
}

type Messages = {
  load(sessionId: string): Promise<ModelMessage[]>
}

function hasCommand(input: unknown): input is { command: string } {
  return (
    typeof input === 'object' &&
    input !== null &&
    'command' in input &&
    typeof input.command === 'string'
  )
}

function hooks(messages: Messages): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context }) => ({
      value: {
        model: 'openai/gpt-5.5',
        messages: await messages.load(context.sessionId)
      }
    }),
    onToolCallStarted: ({ input, toolCallId, toolName }) => {
      if (toolName === 'DeleteAccount') {
        return {
          value: {
            type: 'skip',
            result: {
              toolCallId,
              toolName,
              input,
              error: 'blocked by policy'
            }
          }
        }
      }

      if (toolName === 'Bash') {
        if (!hasCommand(input)) throw new Error('invalid Bash input')

        return {
          value: {
            toolCallId,
            toolName,
            input: { command: `sandbox ${JSON.stringify(input.command)}` }
          }
        }
      }
    }
  }
}

const callTool: AgentMiddleware<
  AgentCallToolArgs<Context>,
  AgentToolCallResponse
> = async ({ input, next }) => {
  if (
    input.toolCall.toolName === 'WebFetch' &&
    process.env.NODE_ENV === 'test'
  ) {
    return {
      toolCallId: input.toolCall.toolCallId,
      toolName: input.toolCall.toolName,
      input: input.toolCall.input,
      output: { fixture: true }
    }
  }

  return next(input)
}

async function runWithTools(params: {
  messages: Messages
  runId: string
  tools: ToolSet
}) {
  await Array.fromAsync(
    runAgent({
      state: {
        runId: params.runId,
        context: { sessionId: params.runId }
      },
      tools: params.tools,
      hooks: hooks(params.messages),
      middleware: { callTool: [callTool] },
      maxTurns: 10
    })
  )
}
```

[`onToolCallStarted`](../../docs/kernel/tools.md#ontoolcallstarted-policy)
handles phase decision: block, rewrite, pause, or continue.
[`callTool`](../../docs/kernel/tools.md#calltool-middleware) handles I/O wrapper
behavior: fixtures, retries, timing, audit, or sandbox execution.

## Resume After Tool Crash

Kernel treats
[in-flight tool calls](../../docs/kernel/tools.md#non-idempotent-default) as
unsafe to replay. If process dies after external side effect starts and before
result commits, resume fails by default.

Tool owner decides when replay is safe. For idempotent APIs, use stable
`toolCallId` as idempotency key and move in-flight calls back to pending before
[resume](../../docs/kernel/state-run.md#pause-and-resume).

```ts
import { type AgentRunState, type AgentToolCall } from '@nanoagent/kernel'

type Context = {
  customerId: string
  sessionId: string
}

function replayChargeCalls(state: AgentRunState<Context>) {
  if (state.status.type !== 'running') return state
  if (state.status.phase !== 'tool_call_completed') return state

  const turn = state.currentTurn
  if (!turn?.toolCalls.inFlight.length) return state
  if (!turn.toolCalls.inFlight.every(isChargeCall)) return state

  return {
    ...state,
    status: { ...state.status, phase: 'tool_call_started' as const },
    currentTurn: {
      ...turn,
      toolCalls: {
        pending: turn.toolCalls.inFlight,
        inFlight: [],
        completed: turn.toolCalls.completed
      }
    }
  }
}

function isChargeCall(call: AgentToolCall) {
  return call.toolName === 'ChargeCard'
}
```

Idempotency policy stays beside system with side effect. Kernel supplies enough
state to make decision explicit. `ChargeCard` implementation passes
`toolCallId` to payment gateway as idempotency key, then caller runs
`runAgent({ state: replayChargeCalls(saved), ... })`.

## JSON Session Recovery Example

Run failure and recovery against real OpenAI model with file-backed state:

```sh
OPENAI_API_KEY=... bun packages/kernel/examples/json-session-recovery.ts fail "Remember that my project is called Atlas"
OPENAI_API_KEY=... bun packages/kernel/examples/json-session-recovery.ts model-fail "Remember that my project is called Atlas"
OPENAI_API_KEY=... bun packages/kernel/examples/json-session-recovery.ts reply "Continue after the failure and answer with the project name"
bun packages/kernel/examples/json-session-recovery.ts show
```

`fail` throws before model call and writes `examples/.sessions/demo.json` with
`status: failed` and saved phase. `model-fail` reaches `model_started`, then
throws a fake provider 500 from `callModel` before `streamText` returns. `reply`
appends new user message to same session, passes saved snapshot back to
`runAgent`, and kernel resumes from failed phase. Events append to
`examples/.sessions/demo.jsonl`.

## Model Boundary

[Model choice](../../docs/kernel/models.md#per-turn-routing) is per turn.
[Provider registry](../../docs/kernel/models.md#provider-registry) is
caller-owned.

```ts
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { ModelMessage } from 'ai'
import {
  type AgentCallModelArgs,
  type AgentCallModelResult,
  type AgentMiddleware,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  sessionId: string
  tenant: 'public' | 'private'
}

type Messages = {
  load(sessionId: string): Promise<ModelMessage[]>
}

const retry429: AgentMiddleware<
  AgentCallModelArgs<Context>,
  AgentCallModelResult
> = async ({ input, next }) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await next(input)
    } catch (error) {
      if (attempt === 2 || !isRateLimit(error)) throw error
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
}

function isRateLimit(error: unknown) {
  return error instanceof Error && /rate limit|429/i.test(error.message)
}

async function runTenant(params: {
  anthropicKey: string
  messages: Messages
  openaiKey: string
  runId: string
  tenant: Context['tenant']
}) {
  await Array.fromAsync(
    runAgent({
      state: {
        runId: params.runId,
        context: {
          sessionId: params.runId,
          tenant: params.tenant
        }
      },
      modelProviders: {
        anthropic: createAnthropic({ apiKey: params.anthropicKey }),
        openai: createOpenAI({ apiKey: params.openaiKey })
      },
      hooks: {
        onTurnPrepared: async ({ context }) => ({
          value: {
            model:
              context.tenant === 'private'
                ? 'anthropic/claude-opus-4-7'
                : 'openai/gpt-5.5',
            messages: await params.messages.load(context.sessionId)
          }
        })
      },
      middleware: { callModel: [retry429] },
      maxTurns: 10
    })
  )
}
```

`model` selects provider prefix plus model name. `modelProviders` supplies
provider values. [`callModel`](../../docs/kernel/middleware.md#retry)
middleware handles retry, fallback, caching, tracing, or output transforms
around model call.

## Persistence Boundary

[`saveState`](../../docs/kernel/api.md#option-savestate) is commit point. Store
state and events transactionally when durable ordering matters.

```ts
import { type AgentSaveState } from '@nanoagent/kernel'

type Context = {
  sessionId: string
}

type Pg = {
  tx<T>(fn: (tx: Pg) => Promise<T>): Promise<T>
  query(sql: string, values: unknown[]): Promise<void>
}

function saveToPostgres(pg: Pg): AgentSaveState<Context> {
  return async ({ events, state }) => {
    await pg.tx(async tx => {
      await tx.query(
        `INSERT INTO agent_runs (id, revision, state)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE
         SET revision = $2, state = $3
         WHERE agent_runs.revision < $2`,
        [state.runId, state.revision, state]
      )
      await tx.query(
        `INSERT INTO agent_events (run_id, revision, event)
         SELECT $1, $2, event
         FROM jsonb_array_elements($3::jsonb) AS event`,
        [state.runId, state.revision, JSON.stringify(events)]
      )
    })
  }
}
```

Kernel never chooses database, queue, file layout,
[compaction policy](../../docs/kernel/state-session.md#model-input-boundary), or
event fanout. It calls `saveState` after each durable transition.

## Cancellation

[`AbortSignal`](../../docs/kernel/api.md#option-signal) means cancellation.
Kernel throws abort reason and stops without writing failed run state.

```ts
import type { ToolSet } from 'ai'
import { type AgentHooks, runAgent } from '@nanoagent/kernel'

type Context = {
  sessionId: string
}

declare const hooks: AgentHooks<Context>
declare const tools: ToolSet

const controller = new AbortController()

for await (const event of runAgent({
  state: { context: { sessionId: 's_123' } },
  hooks,
  tools,
  signal: controller.signal,
  maxTurns: 20
})) {
  console.log(event.type)
}
```

Caller decides where `controller.abort(reason)` comes from: HTTP disconnect,
button click, queue timeout, or worker shutdown.

## API Surface

Kernel exports [types](../../docs/kernel/api.md#exported-types) for state,
events, hooks, middleware, providers, model results, tool calls, and `runAgent`.

Core ownership remains small:

- `AgentRunState` stores durable run position.
- `AgentHooks` participate at phase boundaries.
- `AgentMiddleware` wraps model and tool I/O.
- `AgentStreamEvent` reports committed state and stream parts.
- `AgentSaveState` persists revisions and events.
- `runAgent` executes state machine.

Everything else belongs to product code.
