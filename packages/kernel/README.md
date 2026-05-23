# @nanoagent/kernel

Durable run loop for agent products.

Kernel owns execution state: turn sequencing, phase commits, pause/resume,
model calls, tool calls, stream events, middleware composition, and
cancellation. Product code owns prompts, memory, storage, model credentials,
tools, auth, sandboxing, UI, and policy.

```sh
npm install @nanoagent/kernel
```

## Contract

`runAgent` advances one durable state machine. Nothing runs until caller
iterates returned async generator.

```ts
runAgent({
  state, // AgentRunState | { runId?, context }
  hooks, // phase decisions
  tools, // AI SDK ToolSet
  modelProviders, // provider registry
  middleware, // model/tool wrappers
  saveState, // durable commit callback
  signal, // cancellation
  maxTurns
})
```

Turn flow:

1. `onTurnPrepared` returns exact model input.
2. Kernel calls model and yields `stream_part` events.
3. Kernel commits model result and extracts tool calls.
4. Hooks accept, rewrite, skip, pause, finish, or continue.
5. Middleware wraps model and tool I/O.
6. `saveState` receives revisioned `AgentRunState` plus commit events.

Persist `AgentRunState`, load it, pass it back to `runAgent`. Runtime values
like `tools`, `modelProviders`, `middleware`, `saveState`, and `signal` are
process-local and recreated per call.

## Small Run

`onTurnPrepared` supplies current prompt. `onTurnCompleted` decides which model
output enters caller memory.

```ts
import type { ModelMessage } from 'ai'
import {
  type AgentRunState,
  type AgentStreamEvent,
  type JsonLike,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  [key: string]: JsonLike
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
    maxTurns: 20,
    saveState: ({ state }) => params.store.save(state),
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

        return { control: { type: 'finish', reason: 'model_done' } }
      }
    }
  })) {
    params.emit(event)
  }
}
```

Kernel stores completed turns, but it does not rebuild future prompts. Caller
loads transcript, summaries, retrieved context, or prior turn output inside
`onTurnPrepared`.

## State

Fresh run state can be compact:

```ts
{
  runId: 'run_123',
  context: {
    sessionId: 'session_123'
  }
}
```

Kernel expands it into durable `AgentRunState`:

```ts
type AgentRunState<Context extends JsonLike> = {
  runId: string
  revision: number
  status: AgentRunStatus
  context: Context
  turns: Turn[]
  currentTurn?: Turn
  updatedAt: string
}
```

`revision` increments on every durable commit. `saveState.events` contains only
events for current commit, not full history. Persist state and events in same
transaction when ordering matters.

```ts
import { type AgentSaveState, type JsonLike } from '@nanoagent/kernel'

type Context = {
  [key: string]: JsonLike
  sessionId: string
}

type Pg = {
  tx<T>(fn: (tx: Pg) => Promise<T>): Promise<T>
  query(sql: string, values: unknown[]): Promise<void>
}

function saveToPostgres(pg: Pg): AgentSaveState<Context> {
  return ({ events, state }) =>
    pg.tx(async tx => {
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
```

## Pause

Any hook can pause. Kernel commits paused state and exits generator. Later
process loads same state, updates caller-owned `context` if needed, and calls
`runAgent` again.

```ts
import type { ModelMessage, ToolSet } from 'ai'
import {
  type AgentHooks,
  type AgentRunState,
  type JsonLike,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  [key: string]: JsonLike
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
        model: 'openai/gpt-5.5',
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

Approval lives in `context` because product owns policy. Kernel preserves
execution position: phase, current turn, pending tool calls, in-flight tool
calls, completed tool responses, and prior turns.

## Tool Boundary

Hooks decide policy. Middleware wraps execution.

```ts
import type { ModelMessage, ToolSet } from 'ai'
import {
  type AgentCallToolArgs,
  type AgentHooks,
  type AgentMiddleware,
  type AgentToolCallResponse,
  type JsonLike,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  [key: string]: JsonLike
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

      if (toolName !== 'Bash') return
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

`onToolCallStarted` can continue, rewrite, skip, pause, or finish. `callTool`
middleware can fixture, retry, time, audit, sandbox, or short-circuit execution.

Tool errors become completed tool responses unless middleware throws outside
`AgentToolCallResponse` shape.

## Model Boundary

Model string uses provider prefix:

```txt
<provider>/<model-name>
```

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

`modelProviders` overrides or adds providers. `callModel` middleware handles
retry, routing, tracing, caching, or output transforms around model call.

```ts
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { ModelMessage } from 'ai'
import {
  type AgentCallModelArgs,
  type AgentCallModelResult,
  type AgentMiddleware,
  type JsonLike,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  [key: string]: JsonLike
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

`onModelCompleted` receives canonical `AgentModelResult` plus `rawResult`.
Extract SDK-shaped fields from `rawResult` there and stash needed values in
caller context.

## Resume

Resume behavior:

- `paused` resumes from stored phase.
- `failed` resumes from failed phase.
- `completed` exits without new work.
- `model_started` reruns model call and emits `model_restarted`.
- `tool_call_completed` resumes only when `inFlight` is empty.
- In-flight tool calls fail resume by default because external side effects may
  already have started.

Tool owner decides when replay is safe. For idempotent APIs, use stable
`toolCallId` as idempotency key and move in-flight calls back to pending before
resume.

```ts
import {
  type AgentRunState,
  type AgentToolCall,
  type JsonLike
} from '@nanoagent/kernel'

type Context = {
  [key: string]: JsonLike
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
throws fake provider failure from `callModel` before `streamText` returns.
`reply` appends new user message, passes saved snapshot back to `runAgent`, and
kernel resumes from failed phase. Events append to
`examples/.sessions/demo.jsonl`.

Set `MODEL` to override default `openai/gpt-5.5`.

## Cancellation

`AbortSignal` means caller cancellation. Kernel throws abort reason and stops
without writing failed run state.

```ts
import type { ToolSet } from 'ai'
import { type AgentHooks, type JsonLike, runAgent } from '@nanoagent/kernel'

type Context = {
  [key: string]: JsonLike
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

## Events

`runAgent` yields `AgentStreamEvent` values. Durable phase events also go to
`saveState.events`.

Phase event types:

```txt
run_started
turn_started
turn_prepared
model_started
model_restarted
model_completed
tool_calls_started
tool_call_started
tool_call_completed
tool_calls_completed
turn_completed
run_completed
run_failed
pause
```

`stream_part` events are live model stream parts. They are yielded, but not sent
to `saveState.events`; final model output is committed at `model_completed`.

## API Surface

Primary exports:

- `runAgent`
- `AgentRunState`
- `AgentRunStatus`
- `Turn`
- `AgentHooks`
- `AgentMiddleware`
- `AgentMiddlewareMap`
- `AgentSaveState`
- `AgentStreamEvent`
- `AgentPhaseEvent`
- `AgentModelArgs`
- `AgentModelResult`
- `AgentRawModelResult`
- `AgentToolCall`
- `AgentToolCallResponse`
- `AgentModelProviders`
- `JsonLike`

Everything else belongs to product code.
