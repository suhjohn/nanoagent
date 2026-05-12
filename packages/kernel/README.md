# @nanoagent/kernel

`@nanoagent/kernel` is durable execution kernel for LLM agent runs.

The point is simple: kernel owns sequencing, durable run state, pause/resume, model and tool boundaries, streaming events, the commit barrier, and middleware composition. Everything else belongs to caller code.

```sh
npm install @nanoagent/kernel
```

## Kernel, Not Harness

`@nanoagent/kernel` is the inner execution core used to build agent harnesses. It is not the full harness.

In current coding-agent systems, a harness usually means outer product shell: file tools, shell execution, permissions, MCP, prompt/context management, memory, CLI or server runtime, sandbox policy, approvals UI, and provider credentials.

This package deliberately stops below that layer. It owns run-loop invariants:

- Phase machine.
- Revisioned `AgentRunState`.
- Pause and resume checkpoints.
- Model and tool operation boundaries.
- Hook invocation.
- Middleware composition.
- Stream and persistence ordering.
- Cancellation and terminal-state semantics.

A coding-agent harness can sit on top of `@nanoagent/kernel`. Product code supplies tools, prompts, memory, auth, sandboxing, UI, and storage.

## The Problem

Most agent SDKs expose a chat loop.

- **Claude Code** is a closed binary. Resume means passing a `session_id` string, and hooks are shell commands spawned per event.
- **Codex** has the same basic shape. The TypeScript SDK spawns the `codex` CLI and pipes JSONL over stdin/stdout. Hooks come from JSON configuration and execute as subprocesses.
- **OpenCode** is an HTTP client to a server. Plugin hooks execute inside that server, and the server owns the run loop.
- **Pi** exposes a stateful `Agent` class. Mutable `agent.state` holds messages, tools, pending tool calls, and errors. Durable run state, resume boundary, and middleware stack are missing from the contract.
- **DeepAgents** is a batteries-included LangGraph harness. DeepAgents owns the orchestration graph, default prompt, built-in tools, memory loading, file backend behavior, subagent lifecycle, summarization policy, and stream shaping. The caller configures those systems.

That shape works for a CLI product that is meant to execute on a machine "single-player".

`@nanoagent/kernel` solves "give me the smallest reliable state machine I can build a capable agent around." It owns only the run-loop boundary and exposes explicit phase control. Real agent systems need to pause for human approval, resume in another process, route models per turn, retry model calls through middleware, persist state to their own store, and recover from crashes in the middle of tool execution.

## Scenarios

This difference matters when things go wrong:

- Broken connections need a saved `AgentRunState` that a later process can load.
- Stopping conditions need explicit `maxTurns`, caller `finish`, and cancellation semantics.
- Tool failures need persisted tool-call phase state, so resume can distinguish "not started", "started but unknown", and "completed".
- Human approval needs saved run state that can exit the process and resume elsewhere.
- Subagent output visibility is a stream policy choice for caller code.

### Resume Loads State

The common failure mode is familiar. A customer pays for a long run, returns the next morning, and resumes it. Conversation history is missing. A subagent transcript was loaded as the main transcript. An interrupted JSONL append produced invalid state. The model starts reading the same files again because the SDK reconstructed an approximation of the run.

Caller code fixes this by persisting and reloading run state directly.

The shape is small:

```ts
import type { ModelMessage } from 'ai'
import { type AgentRunState, type AgentStreamEvent, runAgent } from '@nanoagent/kernel'

type Context = {
  sessionId: string
  userId: string
}

type RunStore = {
  load(runId: string): Promise<AgentRunState<Context> | undefined>
  save(state: AgentRunState<Context>): Promise<void>
}

type MessageStore = {
  load(sessionId: string): Promise<ModelMessage[]>
}

async function startOrResume(params: {
  messages: MessageStore
  runId: string
  store: RunStore
  streamToClient(event: AgentStreamEvent): void
  userId: string
}) {
  const saved = await params.store.load(params.runId)
  const state =
    saved ??
    ({
      runId: params.runId,
      context: {
        sessionId: params.runId,
        userId: params.userId
      }
    } satisfies { runId: string; context: Context })

  for await (const event of runAgent({
    state,
    hooks: {
      onTurnPrepared: async ({ context }) => ({
        value: {
          model: 'openai/gpt-5.5',
          messages: await params.messages.load(context.sessionId)
        }
      })
    },
    saveState: ({ state }) => params.store.save(state),
    maxTurns: 100
  })) {
    params.streamToClient(event)
  }
}
```

`AgentRunState` round-trips directly. The state that `saveState` writes is the state passed to `runAgent` on the next process.

From there, kernel resumes from `state.status.phase` with `state.currentTurn.modelArgs`, `state.currentTurn.modelResult`, `state.currentTurn.toolCalls`, and `state.turns` intact. Caller code loads saved state directly, and kernel keeps durable run position inside `AgentRunState`.

### Tool Crashes Need Explicit Semantics

Caller code determines how to handle tool calls. If `ChargeCard` runs and the process dies before the result is persisted, resume needs enough state to avoid double-charging.

Kernel records in-flight tool calls and refuses to replay them by default. The caller decides whether replay is safe because the caller owns the external system.

For idempotent external APIs, caller code can move in-flight calls back to pending and use the stable `toolCallId` as the idempotency key:

```ts
import { jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai'
import { type AgentRunState, runAgent } from '@nanoagent/kernel'

type Context = {
  customerId: string
  sessionId: string
}

type ChargeInput = {
  amountCents: number
  currency: 'usd'
}

type ChargeGateway = {
  createCharge(params: {
    amountCents: number
    currency: 'usd'
    customerId: string
    idempotencyKey: string
  }): Promise<{ chargeId: string; status: 'succeeded' }>
}

type RunStore = {
  load(runId: string): Promise<AgentRunState<Context> | undefined>
  save(state: AgentRunState<Context>): Promise<void>
}

type MessageStore = {
  load(sessionId: string): Promise<ModelMessage[]>
}

function makeTools(chargeGateway: ChargeGateway) {
  return {
    ChargeCard: tool({
      description: 'Charge customer card exactly once.',
      inputSchema: jsonSchema<ChargeInput>({
        type: 'object',
        additionalProperties: false,
        properties: {
          amountCents: { type: 'number' },
          currency: { type: 'string', enum: ['usd'] }
        },
        required: ['amountCents', 'currency']
      }),
      execute: async ({ amountCents, currency }, options) => {
        const context = options.experimental_context as Context

        return chargeGateway.createCharge({
          amountCents,
          currency,
          customerId: context.customerId,
          idempotencyKey: options.toolCallId
        })
      }
    })
  } satisfies ToolSet
}

function replayIdempotentChargeCalls(state: AgentRunState<Context>) {
  if (state.status.type !== 'running') return state
  if (state.status.phase !== 'tool_call_completed') return state

  const turn = state.currentTurn
  if (!turn?.toolCalls.inFlight.length) return state
  if (!turn.toolCalls.inFlight.every(call => call.toolName === 'ChargeCard')) {
    return state
  }

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

async function startOrResume(params: {
  chargeGateway: ChargeGateway
  customerId: string
  messages: MessageStore
  runId: string
  store: RunStore
}) {
  const saved = await params.store.load(params.runId)
  const state = saved
    ? replayIdempotentChargeCalls(saved)
    : {
        runId: params.runId,
        context: {
          customerId: params.customerId,
          sessionId: params.runId
        }
      }

  for await (const event of runAgent({
    state,
    tools: makeTools(params.chargeGateway),
    hooks: {
      onTurnPrepared: async ({ context }) => ({
        value: {
          model: 'openai/gpt-5.5',
          messages: await params.messages.load(context.sessionId)
        }
      })
    },
    saveState: ({ state }) => params.store.save(state),
    maxTurns: 100
  })) {
    console.log(event.type)
  }
}
```

Kernel treats every tool as non-idempotent by default. Resuming at `tool_call_completed` with non-empty `currentTurn.toolCalls.inFlight` throws.

If a tool owner can make replay safe, they pass the stable `toolCallId` to the external system and explicitly move `inFlight` back to `pending` before calling `runAgent`. That is the right place for the decision.

### Pause and Resume Are First-Class

Human approval survives process exit. The agent can pause, persist, exit, and resume from a worker that handles the approval later.

The approval state lives in caller-owned context:

```ts
import type { ModelMessage, ToolSet } from 'ai'
import {
  type AgentHooks,
  type AgentRunState,
  type AgentSaveState,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  approved: string[]
  sessionId: string
  userId: string
}

type RunStore = {
  load(runId: string): Promise<AgentRunState<Context> | undefined>
  save(
    state: AgentRunState<Context>,
    events: readonly StoredEvent[]
  ): Promise<void>
}

type MessageStore = {
  load(sessionId: string): Promise<ModelMessage[]>
}

type Slack = {
  postApproval(params: {
    runId: string
    toolCallId: string
    toolName: string
  }): Promise<void>
}

type StoredEvent = Parameters<AgentSaveState<Context>>[0]['events'][number]

function isApprovalPause(event: StoredEvent) {
  return event.type === 'pause' && event.reason === 'approval_required'
}

function makeHooks(messages: MessageStore): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context }) => ({
      value: {
        model: 'anthropic/claude-opus-4-7',
        messages: await messages.load(context.sessionId)
      }
    }),
    onToolCallStarted: ({ context, toolCallId, toolName }) => {
      if (toolName !== 'ChargeCard') return // Continue normally.
      if (context.approved.includes(toolCallId)) return
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

function makeSaveState(params: {
  slack: Slack
  store: RunStore
}): AgentSaveState<Context> {
  return async ({ state, events }) => {
    await params.store.save(state, events)

    const pause = events.find(isApprovalPause)
    const metadata = pause?.metadata
    if (
      metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      typeof metadata.toolCallId === 'string' &&
      typeof metadata.toolName === 'string'
    ) {
      await params.slack.postApproval({
        runId: state.runId,
        toolCallId: metadata.toolCallId,
        toolName: metadata.toolName
      })
    }
  }
}

async function processRun(params: {
  messages: MessageStore
  runId: string
  slack: Slack
  store: RunStore
  tools: ToolSet
  userId: string
}) {
  const state = (await params.store.load(params.runId)) ?? {
    runId: params.runId,
    context: {
      approved: [],
      sessionId: params.runId,
      userId: params.userId
    }
  }

  for await (const event of runAgent<Context>({
    state,
    tools: params.tools,
    saveState: makeSaveState({
      slack: params.slack,
      store: params.store
    }),
    hooks: makeHooks(params.messages),
    maxTurns: 100
  })) {
    console.log(event.type)
  }
}

async function onSlackApprove(params: {
  messages: MessageStore
  runId: string
  slack: Slack
  store: RunStore
  toolCallId: string
  tools: ToolSet
  userId: string
}) {
  const saved = await params.store.load(params.runId)
  if (!saved) throw new Error(`missing run: ${params.runId}`)

  await params.store.save(
    {
      ...saved,
      revision: saved.revision + 1,
      updatedAt: new Date().toISOString(),
      context: {
        ...saved.context,
        approved: [...new Set([...saved.context.approved, params.toolCallId])]
      }
    },
    []
  )
  await processRun({
    messages: params.messages,
    runId: params.runId,
    slack: params.slack,
    store: params.store,
    tools: params.tools,
    userId: params.userId
  })
}
```

Any hook can return `{ control: { type: 'pause', reason, metadata } }`. Kernel persists the pause and exits the generator.

Later, the approval handler patches caller-owned `context` and calls the same `processRun` function. Pending, in-flight, and completed tool calls remain part of saved run state.

### Finish Is Caller-Controlled

Runs end from three sources: caller `finish`, model completion, or `maxTurns`. Caller `finish` is the explicit product-level stop condition.

Any hook can return `{ control: { type: 'finish', reason, metadata } }`:

```ts
import type { ModelMessage } from 'ai'
import { type AgentHooks } from '@nanoagent/kernel'

type Context = {
  sessionId: string
}

type MessageStore = {
  append(sessionId: string, messages: ModelMessage[]): Promise<void>
  load(sessionId: string): Promise<ModelMessage[]>
}

function makeHooks(messages: MessageStore): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context }) => ({
      value: {
        model: 'openai/gpt-5.5',
        messages: await messages.load(context.sessionId)
      }
    }),
    onTurnCompleted: async ({ context, turn }) => {
      if (!turn.modelResult) return

      await messages.append(
        context.sessionId,
        turn.modelResult.response.messages
      )

      if (turn.modelResult.finishReason === 'stop') {
        return {
          control: {
            type: 'finish',
            reason: 'model_done',
            metadata: { turnCompleted: true }
          }
        }
      }
    }
  }
}
```

Kernel records caller finishes as `run_completed` with `source === 'caller'`. The completion `reason` and `metadata` persist in run state and emit with the completion event.

### Model Routing Is Per-Turn

A run may use a strong model for the first turn, a cheap model for simple follow-up turns, and a private gateway for one tenant. Model selection belongs to each prepared turn.

`onTurnPrepared` is the routing point:

```ts
import type { ModelMessage } from 'ai'
import { type AgentHooks } from '@nanoagent/kernel'

type Context = {
  complexity: 'simple' | 'hard'
  sessionId: string
  tenant: 'public' | 'private'
}

type MessageStore = {
  append(sessionId: string, messages: ModelMessage[]): Promise<void>
  load(sessionId: string): Promise<ModelMessage[]>
}

function makeHooks(messages: MessageStore): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context, turn }) => ({
      value: {
        model:
          turn.turn === 1
            ? 'openai/gpt-5.5'
            : context.complexity === 'simple'
              ? 'groq/llama-3.3-70b'
              : 'anthropic/claude-opus-4-7',
        messages: await messages.load(context.sessionId)
      }
    }),
    onTurnCompleted: async ({ context, turn }) => {
      if (!turn.modelResult) return
      await messages.append(
        context.sessionId,
        turn.modelResult.response.messages
      )
    }
  }
}
```

`onTurnPrepared` returns the model args for that turn. Provider instances come from `runAgent({ modelProviders })`. Routing flags live in `context`, which kernel threads through hooks and serializes into run state.

On resume, the same routing state keeps UI model selection changes from altering an existing run.

### Dynamic Prompts Are Per-Turn

`onTurnPrepared` can append runtime-only context to the end of the messages sent to the model. This is useful for values that should reflect the current process moment, such as current timestamp, while not breaking the input cache.

```ts
import type { ModelMessage } from 'ai'
import { type AgentHooks } from '@nanoagent/kernel'

type Context = {
  sessionId: string
  userId: string
}

type MessageStore = {
  append(sessionId: string, messages: ModelMessage[]): Promise<void>
  load(sessionId: string): Promise<ModelMessage[]>
}

function makeHooks(messages: MessageStore): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context }) => {
      const transcript = await messages.load(context.sessionId)
      const now = new Date().toISOString()

      return {
        value: {
          model: 'openai/gpt-5.5',
          messages: [
            ...transcript,
            {
              role: 'system',
              content: `Current timestamp: ${now}`
            }
          ]
        }
      }
    },
    onTurnCompleted: async ({ context, turn }) => {
      if (!turn.modelResult) return
      await messages.append(
        context.sessionId,
        turn.modelResult.response.messages
      )
    }
  }
}
```

The dynamic message is part of the prepared model args for that turn. If the run resumes after `turn_prepared`, kernel uses the saved messages for that turn instead of regenerating timestamp.

### Model Retries Belong In Middleware

Retry policy is provider-specific. A useful runtime provides the boundary and lets caller middleware encode the semantics for 429s, 5xxs, truncated streams, and empty provider responses.

`callModel` middleware wraps the provider call:

```ts
import { anthropic } from '@ai-sdk/anthropic'
import type { ModelMessage, ToolSet } from 'ai'
import {
  type AgentCallModelArgs,
  type AgentCallModelResult,
  type AgentHooks,
  type AgentMiddleware,
  type AgentRunState,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  sessionId: string
}

type MessageStore = {
  load(sessionId: string): Promise<ModelMessage[]>
}

function isRetryableProviderError(error: unknown) {
  return (
    error instanceof Error &&
    /rate limit|timeout|temporarily unavailable/i.test(error.message)
  )
}

function backoffMs(attempt: number) {
  return 500 * 2 ** attempt
}

const withFallbackModel =
  (params: {
    attempts: number
    fallbackModel: string
    sleep(ms: number): Promise<void>
  }): AgentMiddleware<AgentCallModelArgs<Context>, AgentCallModelResult> =>
  async ({ input, next }) => {
    for (let attempt = 0; attempt < params.attempts; attempt++) {
      try {
        return await next({
          ...input,
          args: {
            ...input.args,
            model: attempt === 0 ? input.args.model : params.fallbackModel
          }
        })
      } catch (err) {
        if (attempt + 1 >= params.attempts || !isRetryableProviderError(err)) {
          throw err
        }
        await params.sleep(backoffMs(attempt))
      }
    }
    throw new Error('attempts must be greater than zero')
  }

const onTruncatedStream: AgentMiddleware<
  AgentCallModelArgs<Context>,
  AgentCallModelResult
> = async ({ input, next }) => {
  const out = await next(input)
  if (out.result.finishReason === 'length') {
    return await next({
      ...input,
      args: { ...input.args, prompt: 'continue' }
    })
  }
  return out
}

async function runWithModelMiddleware(params: {
  messages: MessageStore
  mtlsProvider: typeof anthropic
  runId: string
  saved?: AgentRunState<Context>
  sleep(ms: number): Promise<void>
  tools: ToolSet
}) {
  const state =
    params.saved ??
    ({
      runId: params.runId,
      context: { sessionId: params.runId }
    } satisfies { runId: string; context: Context })
  const hooks: AgentHooks<Context> = {
    onTurnPrepared: async ({ context }) => ({
      value: {
        model: 'private-gateway/claude-sonnet-4-6',
        messages: await params.messages.load(context.sessionId)
      }
    })
  }

  for await (const event of runAgent({
    state,
    hooks,
    tools: params.tools,
    modelProviders: {
      'private-gateway': params.mtlsProvider,
      anthropic
    },
    middleware: {
      callModel: [
        withFallbackModel({
          attempts: 3,
          fallbackModel: 'anthropic/claude-opus-4-7',
          sleep: params.sleep
        }),
        onTruncatedStream
      ]
    },
    maxTurns: 10
  })) {
    console.log(event.type)
  }
}
```

`callModel` middleware composes around the model call. A middleware can call `next` zero times, once, or many times. It can retry, replace, cache, or transform model output.

The model string selects both provider and model. If the first call used `private-gateway/claude-sonnet-4-6`, the fallback above switches the second attempt to `anthropic/claude-opus-4-7`. Both provider instances come from `modelProviders`.

Kernel supplies the composition point, and caller code owns retry semantics.

### Tool Policy Belongs At The Tool Boundary

Tool execution needs both phase decisions and call wrappers. Policy may block one tool call, rewrite another, mock a third in tests, and retry transient failures for a fourth.

Hooks decide the per-call phase policy. Middleware wraps execution:

```ts
import type { ModelMessage, ToolSet } from 'ai'
import {
  type AgentCallToolArgs,
  type AgentHooks,
  type AgentMiddleware,
  type AgentRunState,
  type AgentToolCallResponse,
  runAgent
} from '@nanoagent/kernel'

type Context = {
  sessionId: string
}

type MessageStore = {
  append(sessionId: string, messages: ModelMessage[]): Promise<void>
  load(sessionId: string): Promise<ModelMessage[]>
}

function isBashInput(input: unknown): input is { command: string } {
  return (
    typeof input === 'object' &&
    input !== null &&
    'command' in input &&
    typeof input.command === 'string'
  )
}

function sandbox(command: string) {
  return `sandbox ${JSON.stringify(command)}`
}

function isTransient503(error: unknown) {
  return error instanceof Error && /503/.test(error.message)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function backoffMs(attempt: number) {
  return 250 * 2 ** attempt
}

function makeHooks(messages: MessageStore): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context }) => ({
      value: {
        model: 'openai/gpt-5.5',
        messages: await messages.load(context.sessionId)
      }
    }),
    onToolCallStarted: ({ toolCallId, toolName, input }) => {
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
        if (!isBashInput(input)) throw new Error('invalid Bash input')

        return {
          value: {
            toolCallId,
            toolName,
            input: { ...input, command: sandbox(input.command) }
          }
        }
      }
    },
    onTurnCompleted: async ({ context, turn }) => {
      if (!turn.modelResult) return
      await messages.append(
        context.sessionId,
        turn.modelResult.response.messages
      )
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
  for (let attempt = 0; ; attempt++) {
    const out = await next(input)
    if (!('error' in out) || !isTransient503(out.error) || attempt >= 3)
      return out
    await sleep(backoffMs(attempt))
  }
}

async function runWithToolPolicy(params: {
  messages: MessageStore
  runId: string
  saved?: AgentRunState<Context>
  tools: ToolSet
}) {
  await Array.fromAsync(
    runAgent({
      state:
        params.saved ??
        ({
          runId: params.runId,
          context: { sessionId: params.runId }
        } satisfies { runId: string; context: Context }),
      tools: params.tools,
      hooks: makeHooks(params.messages),
      middleware: { callTool: [callTool] },
      maxTurns: 10
    })
  )
}
```

`onToolCallStarted` decides how this specific call runs. `callTool` middleware wraps execution of that call.

Tool calls run independently, and sibling failures affect the batch only when caller code chooses that policy.

### Cancellation Has Its Own Semantics

Caller aborts are cancellation, not run failure. That distinction matters for persistence, metrics, and resume.

The caller owns the abort signal:

```ts
import type { ToolSet } from 'ai'
import {
  type AgentHooks,
  type AgentRunState,
  type AgentSaveState,
  runAgent
} from '@nanoagent/kernel'

type Context = { userId: string }

type UI = {
  on(event: 'cancel', handler: () => void): void
}

async function runCancellable(params: {
  hooks: AgentHooks<Context>
  saveState: AgentSaveState<Context>
  state: AgentRunState<Context> | { runId: string; context: Context }
  tools: ToolSet
  ui: UI
}) {
  const controller = new AbortController()
  params.ui.on('cancel', () => controller.abort('user cancelled'))

  try {
    for await (const event of runAgent({
      state: params.state,
      tools: params.tools,
      saveState: params.saveState,
      hooks: params.hooks,
      signal: controller.signal,
      maxTurns: 100
    })) {
      console.log(event.type)
    }
  } catch (err) {
    // err is the abort reason. Cancellation skips onRunFailed and run_failed state.
    if (err !== 'user cancelled') throw err
  }
}
```

Kernel checks `signal` before loop iterations, before stream chunks, and after tool results.

When the signal aborts, kernel throws the abort reason and stops without running `onRunFailed` or writing `run_failed` state.

### Hooks Are The Phase Contract

Hooks are TypeScript functions that run in the same process as the agent. They receive typed arguments and return typed decisions.

Each phase has a hook with the same base envelope:

```ts
import type { ModelMessage } from 'ai'
import { type AgentHooks } from '@nanoagent/kernel'

type Context = {
  sessionId: string
}

type MessageStore = {
  append(sessionId: string, messages: ModelMessage[]): Promise<void>
  load(sessionId: string): Promise<ModelMessage[]>
}

function makeHooks(messages: MessageStore): AgentHooks<Context> {
  return {
    onRunStarted: ({ context, state, runId }) => {
      console.log(runId, state.revision, context.sessionId)
    },
    onTurnPrepared: async ({ context, state, runId, turn }) => {
      console.log(runId, state.revision, turn.turn)
      return {
        value: {
          model: 'openai/gpt-5.5',
          messages: await messages.load(context.sessionId)
        }
      }
    },
    onToolCallStarted: ({
      context,
      state,
      runId,
      turn,
      toolCallId,
      toolName,
      input
    }) => {
      console.log(
        runId,
        state.revision,
        context.sessionId,
        turn.turn,
        toolCallId,
        toolName,
        input
      )
    },
    onTurnCompleted: async ({ context, turn }) => {
      if (!turn.modelResult) return
      await messages.append(
        context.sessionId,
        turn.modelResult.response.messages
      )
    },
    onRunFailed: ({ context, state, runId, error }) => {
      console.error(runId, state.revision, context.sessionId, error)
    }
  }
}
```

Every hook receives base envelope: `context`, `state`, and `runId`. Turn-scoped hooks add `turn`. Phase hooks add boundary fields such as `createdAt`, `duration`, `args`, `result`, `rawResult`, `toolCall`, `toolCallId`, `toolName`, `input`, `output`, `error`, `toolCalls`, or `turns`. `onStreamUpdate` receives `createdAt` matching corresponding `stream_part` event.

Base `context` and `state` come from cloned, deeply frozen state snapshot. Boundary payloads are cloned where kernel needs isolation. `rawResult` from model completion is direct SDK object and must not be mutated.

If a phase exists, the hook for that phase is the place where caller code participates.

### Providers Are Plain Values

Custom providers plug into the runtime as plain values. Enterprise gateways, mTLS fetch implementations, local OpenAI-compatible servers, and tenant-specific model registries are normal application code.

The provider registry is caller-owned:

```ts
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { ModelMessage, ToolSet } from 'ai'
import { type AgentHooks, runAgent } from '@nanoagent/kernel'

type Context = {
  sessionId: string
  tenant: 'public' | 'private'
}

type MessageStore = {
  append(sessionId: string, messages: ModelMessage[]): Promise<void>
  load(sessionId: string): Promise<ModelMessage[]>
}

function makeModelProviders(params: {
  gatewayToken: string
  morphAiKey: string
  mtlsFetch: typeof fetch
}) {
  return {
    'nflx-anthropic': createAnthropic({
      baseURL: 'https://gateway.netflix.internal/v1',
      fetch: params.mtlsFetch,
      apiKey: params.gatewayToken
    }),
    'morph-ai': createOpenAI({
      baseURL: 'https://api.morph.ai/v1',
      apiKey: params.morphAiKey
    })
  }
}

function makeHooks(messages: MessageStore): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context }) => ({
      value: {
        model:
          context.tenant === 'private'
            ? 'nflx-anthropic/claude-opus-4-6'
            : 'openai/gpt-5.5',
        messages: await messages.load(context.sessionId)
      }
    }),
    onTurnCompleted: async ({ context, turn }) => {
      if (!turn.modelResult) return
      await messages.append(
        context.sessionId,
        turn.modelResult.response.messages
      )
    }
  }
}

async function runWithProviders(params: {
  gatewayToken: string
  morphAiKey: string
  messages: MessageStore
  mtlsFetch: typeof fetch
  runId: string
  tenant: Context['tenant']
  tools: ToolSet
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
      tools: params.tools,
      modelProviders: makeModelProviders(params),
      hooks: makeHooks(params.messages),
      maxTurns: 10
    })
  )
}
```

`modelProviders` is a registry of provider instances. The caller constructs each provider with the fetch implementation, base URL, headers, and credentials it actually needs.

Auth stays inside caller-owned provider construction.

### Transcript Policy Belongs To Caller Code

Caller code owns conversation memory. It decides when to compact, how to summarize, where to place prompt-cache breakpoints, and how long screenshots stay in context.

The turn hook returns the exact prompt for the next model call:

```ts
import type { ModelMessage } from 'ai'
import { type AgentHooks } from '@nanoagent/kernel'

type Context = {
  sessionId: string
  userId: string
}

type MessageStore = {
  append(sessionId: string, messages: ModelMessage[]): Promise<void>
  load(sessionId: string): Promise<ModelMessage[]>
}

function systemPrompt(): ModelMessage {
  return { role: 'system', content: 'You are concise and accurate.' }
}

function compactIfNeeded(transcript: ModelMessage[]) {
  return transcript.slice(-20)
}

function makeHooks(messages: MessageStore): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context }) => {
      const transcript = await messages.load(context.sessionId)
      const trimmed = compactIfNeeded(transcript)

      return {
        value: {
          model: 'anthropic/claude-opus-4-7',
          messages: [systemPrompt(), ...trimmed]
        }
      }
    },
    onTurnCompleted: async ({ context, turn }) => {
      if (!turn.modelResult) return

      await messages.append(
        context.sessionId,
        turn.modelResult.response.messages
      )
    }
  }
}
```

`onTurnPrepared` returns the literal `messages` sent to the model.

If the product needs memory, retrieval, compaction, summarization, or screenshot pruning, that policy belongs in caller code. Kernel only requires the final model args for the turn.

### Persistence Is A Boundary

Persistence belongs to the application because the application owns the durability requirements. The store may be Postgres, S3, Redis, a queue, a Durable Object, or a local file.

`saveState` is the commit boundary:

```ts
import { type AgentSaveState, runAgent } from '@nanoagent/kernel'

type Context = { userId: string }

type Pg = {
  tx<T>(fn: (tx: Pg) => Promise<T>): Promise<T>
  query(sql: string, values: unknown[]): Promise<void>
}

function makeSaveState(pg: Pg): AgentSaveState<Context> {
  return async ({ state, events }) => {
    await pg.tx(async tx => {
      await tx.query(
        `INSERT INTO agent_runs (id, revision, state) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET revision = $2, state = $3
         WHERE agent_runs.revision < $2`,
        [state.runId, state.revision, state]
      )
      await tx.query(
        `INSERT INTO agent_events (run_id, revision, payload)
         SELECT $1, $2, evt
         FROM jsonb_array_elements($3::jsonb) AS evt`,
        [state.runId, state.revision, JSON.stringify(events)]
      )
    })
  }
}

async function runPersisted(pg: Pg) {
  const saveState = makeSaveState(pg)

  await Array.fromAsync(
    runAgent<Context>({
      state: { runId: 'run_123', context: { userId: 'user_123' } },
      hooks: {
        onTurnPrepared: () => ({
          value: {
            model: 'openai/gpt-5.5',
            messages: [{ role: 'user', content: 'Write status update.' }]
          }
        })
      },
      saveState,
      maxTurns: 1
    })
  )
}
```

`saveState` receives `{ state, events }` at every durable state boundary. It returns a `Promise` for remote stores.

### Small Kernel Contract

Product code owns skills, MCP, shell execution, package managers, slash commands, sandboxing, settings management, system prompt templates, and compaction strategy.

Kernel owns the part that must be correct for all products: the run loop, state transitions, pause/resume semantics, model and tool operation boundaries, streaming events, persistence ordering, middleware composition, and cancellation behavior.

That leaves a deliberately small API surface:

## API

```ts
runAgent({
  hooks,                     // AgentHooks       - your decisions per phase
  state,                     // AgentRunState | { context, runId? }
  tools,                     // ToolSet
  modelProviders?,           // AgentModelProviders
  saveState?,                // AgentSaveState   - persistence callback
  maxTurns,                  // number           - turn cap
  middleware?,               // { callModel?, callTool? } - I/O wrappers
  signal?                    // AbortSignal      - caller cancellation
}): AsyncGenerator<AgentStreamEvent>
```

`runAgent` takes one options object and returns an `AsyncGenerator<AgentStreamEvent>`. Nothing executes until the caller iterates the generator.

The division of responsibility is deliberately small:

- Hooks make phase decisions.
- Middleware wraps model and tool I/O.
- `saveState` persists run state and events.
- `state` supplies durable run state.
- `tools` and `modelProviders` supply runtime values.
- `signal` cancels the run from outside.

That is the whole contract. Everything else is application code.
