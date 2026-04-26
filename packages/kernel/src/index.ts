import { randomUUID } from 'node:crypto'
import { bedrock } from '@ai-sdk/amazon-bedrock'
import { anthropic } from '@ai-sdk/anthropic'
import { azure } from '@ai-sdk/azure'
import { baseten } from '@ai-sdk/baseten'
import { cerebras } from '@ai-sdk/cerebras'
import { cohere } from '@ai-sdk/cohere'
import { deepinfra } from '@ai-sdk/deepinfra'
import { deepseek } from '@ai-sdk/deepseek'
import { fireworks } from '@ai-sdk/fireworks'
import { google } from '@ai-sdk/google'
import { vertex } from '@ai-sdk/google-vertex'
import { groq } from '@ai-sdk/groq'
import { mistral } from '@ai-sdk/mistral'
import { openai } from '@ai-sdk/openai'
import { perplexity } from '@ai-sdk/perplexity'
import { togetherai } from '@ai-sdk/togetherai'
import { vercel } from '@ai-sdk/vercel'
import { xai } from '@ai-sdk/xai'
import { Effect } from 'effect'
import {
  type LanguageModelResponseMetadata,
  type LanguageModelUsage,
  type ModelMessage,
  streamText,
  type TextStreamPart,
  type ToolSet
} from 'ai'
import type {
  AssistantModelMessage,
  MaybePromiseLike,
  ToolCall,
  ToolModelMessage
} from '@ai-sdk/provider-utils'

// Public behavior changes should usually update README.md scenarios.

export type JsonPrimitive = string | number | boolean | null

export type JsonLike =
  | JsonPrimitive
  | { readonly [key: string]: JsonLike }
  | readonly JsonLike[]

export type ReadonlyDeep<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends readonly (infer ITEM)[]
    ? readonly ReadonlyDeep<ITEM>[]
    : T extends object
      ? { readonly [KEY in keyof T]: ReadonlyDeep<T[KEY]> }
      : T

export type AgentToolCall = ToolCall<string, unknown>
export type ReadonlyAgentToolCall = ReadonlyDeep<AgentToolCall>

export type AgentToolCallResponse =
  | {
      toolCallId: string
      toolName: string
      input: unknown
      output: unknown
      error?: never
    }
  | {
      toolCallId: string
      toolName: string
      input: unknown
      error: unknown
      output?: never
    }

export type AgentResponse = LanguageModelResponseMetadata & {
  messages: Array<AssistantModelMessage | ToolModelMessage>
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

export type AgentStreamTextOptions = DistributiveOmit<
  Parameters<typeof streamText<ToolSet>>[0],
  'model' | 'tools' | 'abortSignal'
>

export type AgentModelArgs = AgentStreamTextOptions & {
  model: string
  toolNames: string[]
}

// Un-normalized Vercel AI SDK streamText return. Available on onModelCompleted
// and callModel middleware as an escape hatch for SDK-shaped fields kernel
// does not normalize (toolCalls, toolResults, steps, files). Not cloned, not
// deep-frozen — kernel can't enforce immutability through methods and
// promises.
export type AgentRawModelResult = ReturnType<typeof streamText>

// Canonical model result kernel commits to durable state. Carries JSON-clean
// fields awaited from streamText. SDK-shaped fields kernel does not
// normalize (toolCalls, toolResults, steps, files) stay on rawResult; pull
// them out in onModelCompleted and stash on caller context.
export type AgentModelResult = {
  finishReason?: string
  response: AgentResponse
  totalUsage: LanguageModelUsage
  text?: string
  reasoning?: Awaited<AgentRawModelResult['reasoning']>
  reasoningText?: string
  sources?: Awaited<AgentRawModelResult['sources']>
  warnings?: Awaited<AgentRawModelResult['warnings']>
  providerMetadata?: Awaited<AgentRawModelResult['providerMetadata']>
}

export type SerializedError = {
  message: string
  name?: string
  stack?: string
}

export type AgentCompletionSource = 'caller' | 'model_done' | 'max_turns'

// Live phases the loop can be in. Terminal outcomes live on AgentRunStatus.
export type AgentPhase =
  | 'run_started'
  | 'turn_started'
  | 'turn_prepared'
  | 'model_started'
  | 'model_completed'
  | 'tool_calls_started'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_calls_completed'
  | 'turn_completed'

// One run lifecycle. Phase only exists when run is live (running or paused).
export type AgentRunStatus =
  | { type: 'running'; phase: AgentPhase }
  | {
      type: 'paused'
      phase: AgentPhase
      reason?: string
      metadata?: JsonLike
      createdAt: string
    }
  | {
      type: 'completed'
      source: AgentCompletionSource
      reason?: string
      metadata?: JsonLike
      createdAt: string
    }
  | { type: 'failed'; error: SerializedError; createdAt: string }

export type ToolCallsSnapshot = {
  pending: AgentToolCall[]
  inFlight: AgentToolCall[]
  completed: AgentToolCallResponse[]
}

// One unit of agent work. Same shape whether in progress or completed; later
// phases fill in modelArgs, modelResult, and toolCalls.
export type Turn = {
  turnId: string
  turn: number
  modelArgs?: AgentModelArgs
  modelResult?: AgentModelResult
  toolCalls: ToolCallsSnapshot
}

export type AgentPause = {
  type: 'pause'
  reason?: string
  metadata?: JsonLike
}

export type AgentFinish = {
  type: 'finish'
  reason?: string
  metadata?: JsonLike
}

export type AgentContinue = {
  type: 'continue'
}

export type AgentControl = AgentPause | AgentFinish | AgentContinue

export type AgentRunState<CONTEXT extends JsonLike> = {
  runId: string
  revision: number
  status: AgentRunStatus
  context: CONTEXT
  turns: Turn[]
  currentTurn?: Turn
  updatedAt: string
}

export type AgentPhaseEvent =
  | {
      type: 'run_started'
      runId: string
      revision: number
      createdAt: string
    }
  | {
      type:
        | 'turn_started'
        | 'turn_prepared'
        | 'model_started'
        | 'tool_calls_started'
        | 'tool_call_started'
        | 'tool_calls_completed'
      runId: string
      revision: number
      createdAt: string
      turn: Turn
    }
  | {
      type: 'pause'
      runId: string
      revision: number
      createdAt: string
      phase: AgentPhase
      turn?: Turn
      reason?: string
      metadata?: JsonLike
    }
  | {
      type: 'model_restarted'
      runId: string
      createdAt: string
      turn: Turn
    }
  | {
      type: 'model_completed'
      runId: string
      revision: number
      createdAt: string
      duration: number
      args: AgentModelArgs
      result: AgentModelResult
      turn: Turn
    }
  | {
      type: 'tool_call_completed'
      runId: string
      revision: number
      createdAt: string
      duration: number
      turn: Turn
      toolCallId: string
      toolName: string
      input: unknown
      output?: unknown
      error?: unknown
    }
  | {
      type: 'turn_completed'
      runId: string
      revision: number
      createdAt: string
      duration: number
      turn: Turn
    }
  | {
      type: 'run_completed'
      runId: string
      revision: number
      createdAt: string
      duration: number
      turns: Turn[]
      source: AgentCompletionSource
      reason?: string
      metadata?: JsonLike
    }
  | {
      type: 'run_failed'
      runId: string
      revision: number
      createdAt: string
      error: SerializedError
    }

export type AgentStreamEvent =
  | AgentPhaseEvent
  | {
      type: 'stream_part'
      runId: string
      turnId: string
      turn: number
      createdAt: string
      part: TextStreamPart<ToolSet>
    }

export type AgentSaveState<CONTEXT extends JsonLike> = (args: {
  state: AgentRunState<CONTEXT>
  events: AgentPhaseEvent[]
}) => AgentEffectResult<void>

export type AgentMiddlewareNext<INPUT, OUTPUT> = (
  input: INPUT
) => Promise<OUTPUT>

export type AgentMiddleware<INPUT, OUTPUT> = (args: {
  input: INPUT
  next: AgentMiddlewareNext<INPUT, OUTPUT>
}) => AgentEffectResult<OUTPUT>

export type AgentEffectResult<A, E extends Error = Error> =
  | MaybePromiseLike<A>
  | Effect.Effect<A, E, never>

export type AgentHookResult<VALUE, CONTEXT extends JsonLike> = void | {
  context?: CONTEXT
  value?: VALUE
  control?: AgentControl
}

export type AgentVoidHookResult<CONTEXT extends JsonLike> = void | {
  context?: CONTEXT
  control?: AgentControl
}

export type AgentToolCallsStartedValue = readonly AgentToolCall[]

export type AgentToolCallStartedValue =
  | AgentToolCall
  | {
      type: 'skip'
      result: AgentToolCallResponse
    }

export type AgentModelProviders = Record<
  string,
  (modelName: string) => ReturnType<typeof openai>
>

export type AgentTurnPreparedValue = AgentStreamTextOptions & {
  model: string
}

export type BaseHookArgs<CONTEXT extends JsonLike> = {
  context: ReadonlyDeep<CONTEXT>
  state: ReadonlyDeep<AgentRunState<CONTEXT>>
  runId: string
}

export type AgentRunStartedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
  }

export type AgentTurnStartedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    turn: Turn
  }

export type AgentTurnPreparedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    turn: Turn
  }

export type AgentModelStartedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    args: AgentModelArgs
    createdAt: string
    turn: Turn
  }

export type AgentModelCompletedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    args: AgentModelArgs
    createdAt: string
    duration: number
    result: AgentModelResult
    /**
     * Un-normalized Vercel AI SDK streamText return. Use to extract
     * SDK-shaped fields (reasoning, sources, steps, files, warnings) that
     * are not part of the canonical AgentModelResult, then stash extracted
     * values in context. Not cloned, not deep-frozen — do not mutate.
     */
    rawResult: AgentRawModelResult
    turn: Turn
  }

export type AgentCallModelArgs<CONTEXT extends JsonLike> =
  AgentModelCompletedArgs<CONTEXT> & {
    pendingToolCalls: AgentToolCall[]
  }

export type AgentCallModelResult = {
  pendingToolCalls: AgentToolCall[]
  result: AgentModelResult
}

export type AgentStreamUpdateArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    part: TextStreamPart<ToolSet>
    turn: Turn
  }

export type AgentToolCallsStartedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    result: AgentModelResult
    toolCalls: readonly ReadonlyAgentToolCall[]
    turn: Turn
  }

export type AgentToolCallStartedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    toolCall: ReadonlyAgentToolCall
    toolCallId: string
    toolName: string
    input: unknown
    turn: Turn
  }

export type AgentToolCallCompletedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    duration: number
    toolCallId: string
    toolName: string
    input: unknown
    turn: Turn
  } & (
    | {
        output: unknown
        error?: never
      }
    | {
        error: unknown
        output?: never
      }
  )

export type AgentCallToolArgs<CONTEXT extends JsonLike> = {
  context: CONTEXT
  messages: ModelMessage[]
  signal?: AbortSignal
  toolCall: AgentToolCall
  tools: ToolSet
}

export type AgentToolCallsCompletedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    result: AgentModelResult
    toolCalls: AgentToolCallResponse[]
    turn: Turn
  }

export type AgentTurnCompletedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    duration: number
    turn: Turn
  }

export type AgentRunCompletedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    duration: number
    turns: Turn[]
  }

export type AgentStreamPartEvent = Extract<
  AgentStreamEvent,
  { type: 'stream_part' }
>

export type AgentMiddlewareMap<CONTEXT extends JsonLike> = {
  callModel?: Array<
    AgentMiddleware<AgentCallModelArgs<CONTEXT>, AgentCallModelResult>
  >
  callTool?: Array<
    AgentMiddleware<AgentCallToolArgs<CONTEXT>, AgentToolCallResponse>
  >
}

export type AgentRunFailedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    error: unknown
  }

export type AgentPauseArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    phase: AgentPhase
    turn?: Turn
    reason?: string
    metadata?: JsonLike
  }

export type AgentModelRestartedArgs<CONTEXT extends JsonLike> =
  BaseHookArgs<CONTEXT> & {
    createdAt: string
    turn: Turn
  }

export type AgentRuntime<CONTEXT extends JsonLike> = {
  state: AgentRunState<CONTEXT> | { context: CONTEXT; runId?: string }
  tools?: ToolSet
  modelProviders?: AgentModelProviders
}

export type AgentHooks<CONTEXT extends JsonLike> = {
  onRunStarted?: (
    args: AgentRunStartedArgs<CONTEXT>
  ) => AgentEffectResult<AgentVoidHookResult<CONTEXT>>
  onTurnStarted?: (
    args: AgentTurnStartedArgs<CONTEXT>
  ) => AgentEffectResult<AgentVoidHookResult<CONTEXT>>
  /**
   * Return exact model input for this turn.
   *
   * This is the client's message assembly boundary: load transcript, summaries,
   * memories, retrieved context, or hidden system notes, then choose the exact
   * messages sent to the model for this turn.
   *
   * Core does not append assistant/tool messages to future turns. Completed
   * output is stored in state.turns, and caller code must include any prior
   * turn's response.messages or tool results in the next messages array.
   */
  onTurnPrepared: (
    args: AgentTurnPreparedArgs<CONTEXT>
  ) => AgentEffectResult<AgentHookResult<AgentTurnPreparedValue, CONTEXT>>
  onModelStarted?: (
    args: AgentModelStartedArgs<CONTEXT>
  ) => AgentEffectResult<AgentVoidHookResult<CONTEXT>>
  /**
   * Observation hook for resumed model phase. Fires after the run has
   * committed back to the model_started phase on resume, before the
   * model_restarted event yields. Void — cannot change run state.
   */
  onModelRestarted?: (
    args: AgentModelRestartedArgs<CONTEXT>
  ) => AgentEffectResult<void>
  /**
   * Receives the built AgentModelResult plus rawResult (the un-normalized
   * Vercel AI SDK streamText return). Extract SDK-shaped fields from rawResult
   * here and stash them in context for later hooks.
   */
  onModelCompleted?: (
    args: AgentModelCompletedArgs<CONTEXT>
  ) => AgentEffectResult<AgentVoidHookResult<CONTEXT>>
  /**
   * Observation hook for pause. Fires after the paused snapshot is committed,
   * before the pause event yields. Void — cannot change run state.
   */
  onPause?: (args: AgentPauseArgs<CONTEXT>) => AgentEffectResult<void>
  onStreamUpdate?: (
    args: AgentStreamUpdateArgs<CONTEXT>
  ) => AgentEffectResult<void>
  onToolCallsStarted?: (
    args: AgentToolCallsStartedArgs<CONTEXT>
  ) => AgentEffectResult<AgentHookResult<AgentToolCallsStartedValue, CONTEXT>>
  onToolCallStarted?: (
    args: AgentToolCallStartedArgs<CONTEXT>
  ) => AgentEffectResult<AgentHookResult<AgentToolCallStartedValue, CONTEXT>>
  onToolCallCompleted?: (
    args: AgentToolCallCompletedArgs<CONTEXT>
  ) => AgentEffectResult<AgentVoidHookResult<CONTEXT>>
  onToolCallsCompleted?: (
    args: AgentToolCallsCompletedArgs<CONTEXT>
  ) => AgentEffectResult<AgentVoidHookResult<CONTEXT>>
  /**
   * Good place to update caller-owned conversation memory from the completed
   * turn's modelResult.response and toolCalls.completed before next
   * onTurnPrepared call.
   */
  onTurnCompleted?: (
    args: AgentTurnCompletedArgs<CONTEXT>
  ) => AgentEffectResult<AgentVoidHookResult<CONTEXT>>
  onRunCompleted?: (
    args: AgentRunCompletedArgs<CONTEXT>
  ) => AgentEffectResult<AgentVoidHookResult<CONTEXT>>
  onRunFailed?: (
    args: AgentRunFailedArgs<CONTEXT>
  ) => AgentEffectResult<AgentVoidHookResult<CONTEXT>>
}

export type RunAgentOptions<CONTEXT extends JsonLike> =
  AgentRuntime<CONTEXT> & {
    maxTurns: number
    hooks: AgentHooks<CONTEXT>
    saveState?: AgentSaveState<CONTEXT>
    middleware?: AgentMiddlewareMap<CONTEXT>
    signal?: AbortSignal
  }

const DEFAULT_MODEL_PROVIDERS = {
  openai,
  anthropic,
  azure,
  baseten,
  cerebras,
  cohere,
  deepinfra,
  deepseek,
  fireworks,
  google,
  gemini: google,
  vertex,
  'google-vertex': vertex,
  groq,
  grok: xai,
  mistral,
  perplexity,
  together: togetherai,
  togetherai,
  bedrock,
  'amazon-bedrock': bedrock,
  vercel,
  xai
} satisfies AgentModelProviders

function normalizeModelProviders(modelProviders?: AgentModelProviders) {
  return Object.fromEntries(
    Object.entries(modelProviders ?? {})
      .map(([provider, modelProvider]) => [
        provider.trim().toLowerCase(),
        modelProvider
      ])
      .filter(([provider]) => provider)
  ) as AgentModelProviders
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    }
  }

  return { message: String(error) }
}

function fromAgentResult<A>(
  evaluate: () => AgentEffectResult<A, Error> | undefined
): Effect.Effect<A, Error, never> {
  return Effect.flatMap(
    Effect.try({
      try: evaluate,
      catch: toError
    }),
    result =>
      Effect.isEffect(result)
        ? result
        : Effect.tryPromise({
            try: () => Promise.resolve(result as A | PromiseLike<A>),
            catch: toError
          })
  )
}

function runMiddleware<INPUT, OUTPUT>({
  input,
  middleware,
  terminal
}: {
  input: INPUT
  middleware?: AgentMiddleware<INPUT, OUTPUT>[]
  terminal: (input: INPUT) => AgentEffectResult<OUTPUT>
}): Effect.Effect<OUTPUT, Error, never> {
  const operation = (middleware ?? []).reduceRight<
    (input: INPUT) => Effect.Effect<OUTPUT, Error, never>
  >(
    (next, current) => input =>
      fromAgentResult(() =>
        current({
          input,
          next: nextInput => Effect.runPromise(next(nextInput))
        })
      ),
    input => fromAgentResult(() => terminal(input))
  )
  return operation(input)
}

function checkNotAborted(signal?: AbortSignal): Effect.Effect<void, Error> {
  if (!signal?.aborted) {
    return Effect.void
  }

  return Effect.fail(
    signal.reason instanceof Error
      ? signal.reason
      : new Error('Agent run aborted.')
  )
}

function nowIso() {
  return new Date().toISOString()
}

function durationMs(startCreatedAt: string, endCreatedAt: string) {
  return Date.parse(endCreatedAt) - Date.parse(startCreatedAt)
}

function cloneUnknown<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value
  }

  try {
    return structuredClone(value)
  } catch {
    if (Array.isArray(value)) {
      return value.map(item => cloneUnknown(item)) as T
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, cloneUnknown(entry)])
      ) as T
    }

    return value
  }
}

function cloneModelResult(modelResult: AgentModelResult): AgentModelResult {
  return {
    ...modelResult,
    response: {
      ...modelResult.response,
      messages: [...modelResult.response.messages]
    }
  }
}

function cloneTurn(turn: Turn): Turn {
  return {
    turnId: turn.turnId,
    turn: turn.turn,
    modelArgs: turn.modelArgs ? cloneUnknown(turn.modelArgs) : undefined,
    modelResult: turn.modelResult
      ? cloneModelResult(turn.modelResult)
      : undefined,
    toolCalls: {
      pending: turn.toolCalls.pending.map(cloneToolCall),
      inFlight: turn.toolCalls.inFlight.map(cloneToolCall),
      completed: [...turn.toolCalls.completed]
    }
  }
}

function cloneToolCall(toolCall: AgentToolCall | ReadonlyAgentToolCall) {
  return {
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: cloneUnknown(toolCall.input)
  } satisfies AgentToolCall
}

function deepFreeze<T>(
  value: T,
  seen = new WeakSet<object>()
): ReadonlyDeep<T> {
  if (typeof value !== 'object' || value === null) {
    return value as ReadonlyDeep<T>
  }

  const prototype = Object.getPrototypeOf(value)
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return value as ReadonlyDeep<T>
  }

  if (seen.has(value)) {
    return value as ReadonlyDeep<T>
  }
  seen.add(value)

  for (const property of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[property], seen)
  }

  return Object.freeze(value) as ReadonlyDeep<T>
}

function isSkip(
  value: unknown
): value is Extract<AgentToolCallStartedValue, { type: 'skip' }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'skip'
  )
}

function toModelTools(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, toolConfig]) => {
      const { execute: _execute, ...definition } = toolConfig
      return [toolName, definition]
    })
  ) as ToolSet
}

function resolveModel({
  model,
  modelProviders
}: {
  model: string
  modelProviders: AgentModelProviders
}): Effect.Effect<ReturnType<AgentModelProviders[string]>, Error, never> {
  const [rawProvider, ...modelParts] = model.split('/')
  const modelName = modelParts.join('/').trim()
  const provider = rawProvider?.trim().toLowerCase()

  if (!provider || !modelName) {
    return Effect.fail(
      new Error(`Invalid model "${model}". Expected "<provider>/<model-name>".`)
    )
  }

  const modelProvider = modelProviders[provider]
  if (!modelProvider) {
    return Effect.fail(
      new Error(
        `Unsupported model provider "${provider}". Supported providers: ${Object.keys(modelProviders).join(', ')}.`
      )
    )
  }

  return Effect.try({
    try: () => modelProvider(modelName),
    catch: toError
  })
}

async function buildModelResult(
  result: AgentRawModelResult
): Promise<AgentModelResult> {
  const [
    response,
    finishReason,
    totalUsage,
    text,
    reasoning,
    reasoningText,
    sources,
    warnings,
    providerMetadata
  ] = await Promise.all([
    result.response,
    result.finishReason,
    result.totalUsage,
    result.text,
    result.reasoning,
    result.reasoningText,
    result.sources,
    result.warnings,
    result.providerMetadata
  ])

  return {
    finishReason,
    response,
    totalUsage,
    text,
    reasoning,
    reasoningText,
    sources,
    warnings,
    providerMetadata
  }
}

type AgentEventGenerator = AsyncGenerator<AgentStreamEvent, void, void>

function makeBaseArgs<CONTEXT extends JsonLike>(
  state: AgentRunState<CONTEXT>
): BaseHookArgs<CONTEXT> {
  const readonlyState = deepFreeze(cloneUnknown(state))
  return {
    context: readonlyState.context,
    state: readonlyState,
    runId: state.runId
  }
}

function emptyToolCalls(): ToolCallsSnapshot {
  return { pending: [], inFlight: [], completed: [] }
}

type Snapshotter<CONTEXT extends JsonLike> = (
  nextSnapshot: AgentRunState<CONTEXT>,
  events: AgentPhaseEvent[]
) => Promise<AgentPhaseEvent[]>

function persistSnapshot<CONTEXT extends JsonLike>({
  events,
  previousRevision,
  saveState,
  state
}: {
  saveState?: AgentSaveState<CONTEXT>
  events: AgentPhaseEvent[]
  previousRevision: number
  state: AgentRunState<CONTEXT>
}): Effect.Effect<
  {
    events: AgentPhaseEvent[]
    state: AgentRunState<CONTEXT>
  },
  Error,
  never
> {
  const snapshottedState = {
    ...state,
    revision: previousRevision + 1,
    updatedAt: nowIso()
  }
  const snapshottedEvents = events.map(event =>
    'revision' in event
      ? { ...event, revision: snapshottedState.revision }
      : event
  )

  return Effect.gen(function* () {
    if (saveState) {
      yield* fromAgentResult(() =>
        saveState({
          state: cloneUnknown(snapshottedState),
          events: snapshottedEvents
        })
      )
    }
    return {
      events: snapshottedEvents,
      state: snapshottedState
    }
  })
}

function withRunning<CONTEXT extends JsonLike>(
  state: AgentRunState<CONTEXT>,
  phase: AgentPhase
): AgentRunState<CONTEXT> {
  return {
    ...state,
    status: { type: 'running', phase }
  }
}

function applyContext<CONTEXT extends JsonLike, VALUE>({
  snapshot,
  hookResult
}: {
  snapshot: AgentRunState<CONTEXT>
  hookResult: AgentHookResult<VALUE, CONTEXT>
}) {
  if (hookResult?.context !== undefined) {
    return {
      ...snapshot,
      context: hookResult.context
    }
  }

  return snapshot
}

async function snapshotPause<CONTEXT extends JsonLike>({
  pause,
  snapshotter,
  snapshot
}: {
  snapshotter: Snapshotter<CONTEXT>
  pause: AgentPause
  snapshot: AgentRunState<CONTEXT>
}) {
  if (snapshot.status.type !== 'running') {
    throw new Error('Cannot pause a run that is not running.')
  }
  const createdAt = nowIso()
  const phase = snapshot.status.phase
  return snapshotter(
    {
      ...snapshot,
      status: {
        type: 'paused',
        phase,
        reason: pause.reason,
        metadata: pause.metadata,
        createdAt
      }
    },
    [
      {
        type: 'pause',
        runId: snapshot.runId,
        revision: snapshot.revision,
        createdAt,
        phase,
        turn: snapshot.currentTurn
          ? cloneTurn(snapshot.currentTurn)
          : undefined,
        reason: pause.reason,
        metadata: pause.metadata
      }
    ]
  )
}

function executeToolCall<CONTEXT extends JsonLike>({
  context,
  toolCall,
  messages,
  signal,
  tools
}: {
  context: CONTEXT
  toolCall: AgentToolCall
  messages: ModelMessage[]
  signal?: AbortSignal
  tools: ToolSet
}): Effect.Effect<AgentToolCallResponse, Error, never> {
  const execute = tools[toolCall.toolName]?.execute
  if (!execute) {
    return Effect.fail(
      new Error(`Tool "${toolCall.toolName}" is not executable.`)
    )
  }

  const response = {
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: toolCall.input
  }

  return Effect.match(
    Effect.tryPromise({
      try: async () => {
        const output = await execute(toolCall.input, {
          toolCallId: toolCall.toolCallId,
          messages,
          abortSignal: signal,
          experimental_context: context
        })
        if (
          typeof output !== 'object' ||
          output === null ||
          !(Symbol.asyncIterator in output)
        ) {
          return output
        }

        let finalOutput: unknown
        for await (const chunk of output as AsyncIterable<unknown>) {
          finalOutput = chunk
        }
        return finalOutput
      },
      catch: toError
    }),
    {
      onFailure: error => ({ ...response, error }),
      onSuccess: output => ({ ...response, output })
    }
  )
}

export async function* runAgent<CONTEXT extends JsonLike>(
  options: RunAgentOptions<CONTEXT>
): AgentEventGenerator {
  const tools: ToolSet = options.tools ?? {}
  const modelProviders: AgentModelProviders = {
    ...DEFAULT_MODEL_PROVIDERS,
    ...normalizeModelProviders(options.modelProviders)
  }

  let snapshot: AgentRunState<CONTEXT> =
    'status' in options.state
      ? cloneUnknown(options.state)
      : {
          runId: options.state.runId ?? randomUUID(),
          revision: 0,
          status: { type: 'running', phase: 'run_started' },
          context: options.state.context,
          turns: [],
          updatedAt: nowIso()
        }

  const hooks = options.hooks
  const runCreatedAt = snapshot.updatedAt

  // Caller-emitted finish from any hook. The main loop consumes this and
  // transitions to status.completed at the next checkpoint.
  let pendingFinish:
    | { source: AgentCompletionSource; reason?: string; metadata?: JsonLike }
    | undefined
  let pendingContinue = false

  async function* emitEvents(
    events: Iterable<AgentStreamEvent>
  ): AgentEventGenerator {
    for (const event of events) {
      if (event.type === 'pause') {
        await Effect.runPromise(
          fromAgentResult(() =>
            hooks.onPause?.({
              ...makeBaseArgs(snapshot),
              createdAt: event.createdAt,
              phase: event.phase,
              turn: event.turn,
              reason: event.reason,
              metadata: event.metadata
            })
          )
        )
      } else if (event.type === 'model_restarted') {
        await Effect.runPromise(
          fromAgentResult(() =>
            hooks.onModelRestarted?.({
              ...makeBaseArgs(snapshot),
              createdAt: event.createdAt,
              turn: event.turn
            })
          )
        )
      }
      yield event
    }
  }

  const snapshotState: Snapshotter<CONTEXT> = async (
    nextSnapshot,
    events
  ) => {
    const snapshotted = await Effect.runPromise(
      persistSnapshot({
        events,
        previousRevision: snapshot.revision,
        saveState: options.saveState,
        state: nextSnapshot
      })
    )
    snapshot = snapshotted.state
    return snapshotted.events
  }

  function isPaused() {
    return snapshot.status.type === 'paused'
  }

  function phaseEvent(
    type: Exclude<
      AgentPhaseEvent['type'],
      | 'pause'
      | 'model_restarted'
      | 'model_completed'
      | 'tool_call_completed'
      | 'turn_completed'
      | 'run_completed'
      | 'run_failed'
    >
  ): AgentPhaseEvent {
    if (type === 'run_started') {
      return {
        type,
        runId: snapshot.runId,
        revision: snapshot.revision,
        createdAt: nowIso()
      }
    }
    if (!snapshot.currentTurn) {
      throw new Error(`Cannot emit ${type} without a current turn.`)
    }
    return {
      type,
      runId: snapshot.runId,
      revision: snapshot.revision,
      createdAt: nowIso(),
      turn: cloneTurn(snapshot.currentTurn)
    }
  }

  async function applyHookResult<VALUE>(
    hookResult: AgentHookResult<VALUE, CONTEXT>,
    options: {
      onPause?: (pause: AgentPause) => Promise<AgentPhaseEvent[]>
      // 'ignore' suppresses control: 'finish' (used inside completeRun to
      // prevent reentrant finish from onRunCompleted).
      onFinish?: 'request' | 'ignore'
      // 'ignore' suppresses control: 'continue' when continuation is invalid.
      onContinue?: 'request' | 'ignore'
      persistContext?: boolean
    } = {}
  ): Promise<{
    events?: AgentPhaseEvent[]
    value?: VALUE
  }> {
    const hasContextUpdate = hookResult?.context !== undefined
    snapshot = applyContext({ snapshot, hookResult })
    const control = hookResult?.control
    if (control?.type === 'pause') {
      const onPause =
        options.onPause ??
        ((pause: AgentPause) =>
          snapshotPause({
            snapshotter: snapshotState,
            pause,
            snapshot
          }))
      return {
        events: await onPause(control)
      }
    }
    if (control?.type === 'finish' && options.onFinish !== 'ignore') {
      pendingFinish = {
        source: 'caller',
        reason: control.reason,
        metadata: control.metadata
      }
      return { events: [] }
    }
    if (control?.type === 'continue' && options.onContinue !== 'ignore') {
      pendingContinue = true
      return { events: [] }
    }
    if (hasContextUpdate && options.persistContext) {
      return { events: await snapshotState(snapshot, []) }
    }

    return { value: hookResult?.value as VALUE | undefined }
  }

  async function prepareStartedTurn(prefixEvents: AgentPhaseEvent[] = []) {
    const currentTurn = snapshot.currentTurn
    if (!currentTurn) {
      throw new Error('Cannot prepare turn without a current turn.')
    }

    const preparedHook = await Effect.runPromise(
      fromAgentResult(() =>
        hooks.onTurnPrepared({
          ...makeBaseArgs(snapshot),
          createdAt: nowIso(),
          turn: cloneTurn(currentTurn)
        })
      )
    )
    const preparedResult = await applyHookResult(preparedHook)
    if (preparedResult.events) {
      return { events: [...prefixEvents, ...preparedResult.events] }
    }
    if (!preparedResult.value) {
      throw new Error('onTurnPrepared must return a turn configuration.')
    }

    const { model: preparedModel, ...streamTextOptions } = preparedResult.value
    const modelArgs = {
      ...streamTextOptions,
      model: preparedModel,
      toolNames: Object.keys(tools)
    } as AgentModelArgs
    const preparedSnapshot: AgentRunState<CONTEXT> = {
      ...snapshot,
      status: { type: 'running', phase: 'turn_prepared' },
      currentTurn: {
        ...snapshot.currentTurn!,
        modelArgs
      }
    }
    snapshot = preparedSnapshot

    return {
      events: [
        ...prefixEvents,
        ...(await snapshotState(preparedSnapshot, [
          phaseEvent('turn_prepared')
        ]))
      ]
    }
  }

  async function prepareTurn(turnNumber: number) {
    const turnId = randomUUID()
    const turnCreatedAt = nowIso()
    const startedTurn: Turn = {
      turnId,
      turn: turnNumber,
      toolCalls: emptyToolCalls()
    }
    const turnStartedSnapshot: AgentRunState<CONTEXT> = {
      ...snapshot,
      status: { type: 'running', phase: 'turn_started' },
      currentTurn: startedTurn
    }
    snapshot = turnStartedSnapshot
    const turnStartedEvents = await snapshotState(turnStartedSnapshot, [
      phaseEvent('turn_started')
    ])

    const turnStartedHook = await Effect.runPromise(
      fromAgentResult(() =>
        hooks.onTurnStarted?.({
          ...makeBaseArgs(snapshot),
          createdAt: turnCreatedAt,
          turn: cloneTurn(startedTurn)
        })
      )
    )
    const turnStartedResult = await applyHookResult(turnStartedHook, {
      persistContext: true
    })
    if ((isPaused() || pendingFinish) && turnStartedResult.events) {
      return { events: [...turnStartedEvents, ...turnStartedResult.events] }
    }

    return prepareStartedTurn(turnStartedEvents)
  }

  async function* runModel(): AgentEventGenerator {
    const currentTurn = snapshot.currentTurn
    if (!currentTurn?.modelArgs) {
      throw new Error('Cannot run model without a prepared turn.')
    }

    const modelArgs = {
      ...currentTurn.modelArgs,
      toolNames: [...currentTurn.modelArgs.toolNames]
    } as AgentModelArgs
    const modelStartedAt = nowIso()
    const wasResumingFromModelStarted =
      snapshot.status.type === 'running' &&
      snapshot.status.phase === 'model_started'

    const modelStartedSnapshot: AgentRunState<CONTEXT> = {
      ...snapshot,
      status: { type: 'running', phase: 'model_started' }
    }
    snapshot = modelStartedSnapshot

    const startedEvents: AgentPhaseEvent[] = wasResumingFromModelStarted
      ? [
          {
            type: 'model_restarted',
            runId: snapshot.runId,
            createdAt: nowIso(),
            turn: cloneTurn(currentTurn)
          }
        ]
      : await snapshotState(modelStartedSnapshot, [phaseEvent('model_started')])

    yield* emitEvents(startedEvents)

    const modelStartedHook = await Effect.runPromise(
      fromAgentResult(() =>
        hooks.onModelStarted?.({
          ...makeBaseArgs(snapshot),
          args: modelArgs,
          createdAt: modelStartedAt,
          turn: cloneTurn(currentTurn)
        })
      )
    )
    const modelStartedResult = await applyHookResult(modelStartedHook, {
      persistContext: true
    })
    if ((isPaused() || pendingFinish) && modelStartedResult.events) {
      yield* emitEvents(modelStartedResult.events)
      return
    }

    const {
      model: modelName,
      toolNames: _toolNames,
      ...streamTextOptions
    } = modelArgs
    const model = await Effect.runPromise(
      resolveModel({ model: modelName, modelProviders })
    )
    const rawResult = await Effect.runPromise(
      Effect.try({
        try: () =>
          streamText({
            ...streamTextOptions,
            model,
            tools: toModelTools(tools),
            abortSignal: options.signal
          } as Parameters<typeof streamText<ToolSet>>[0]),
        catch: toError
      })
    )

    for await (const part of rawResult.fullStream) {
      await Effect.runPromise(checkNotAborted(options.signal))
      const createdAt = nowIso()
      await Effect.runPromise(
        fromAgentResult(() =>
          hooks.onStreamUpdate?.({
            ...makeBaseArgs(snapshot),
            createdAt,
            part,
            turn: cloneTurn(currentTurn)
          })
        )
      )
      const streamEvent: AgentStreamPartEvent = {
        type: 'stream_part',
        runId: snapshot.runId,
        turnId: currentTurn.turnId,
        turn: currentTurn.turn,
        createdAt,
        part
      }
      yield* emitEvents([streamEvent])
    }

    const modelResult = cloneModelResult(await buildModelResult(rawResult))
    const pendingToolCalls =
      modelResult.finishReason === 'tool-calls'
        ? (
            await Effect.runPromise(
              Effect.tryPromise({
                try: () => rawResult.toolCalls,
                catch: toError
              })
            )
          ).map(cloneToolCall)
        : []

    const completedAt = nowIso()
    const duration = durationMs(modelStartedAt, completedAt)
    const callModelResult = await Effect.runPromise(
      runMiddleware({
        input: {
          ...makeBaseArgs(snapshot),
          args: modelArgs,
          createdAt: completedAt,
          duration,
          pendingToolCalls,
          result: cloneModelResult(modelResult),
          rawResult,
          turn: cloneTurn(currentTurn)
        },
        middleware: options.middleware?.callModel,
        terminal: input => ({
          pendingToolCalls: input.pendingToolCalls.map(cloneToolCall),
          result: cloneModelResult(input.result)
        })
      })
    )
    const modelCompletedHook = await Effect.runPromise(
      fromAgentResult(() =>
        hooks.onModelCompleted?.({
          ...makeBaseArgs(snapshot),
          args: modelArgs,
          createdAt: completedAt,
          duration,
          result: cloneModelResult(callModelResult.result),
          rawResult,
          turn: cloneTurn(currentTurn)
        })
      )
    )
    const modelCompletedResult = await applyHookResult(modelCompletedHook)
    if (modelCompletedResult.events) {
      yield* emitEvents(modelCompletedResult.events)
      return
    }

    const nextTurn: Turn = {
      ...currentTurn,
      modelResult: callModelResult.result,
      toolCalls: {
        pending: callModelResult.pendingToolCalls,
        inFlight: [],
        completed: []
      }
    }
    const modelCompletedSnapshot: AgentRunState<CONTEXT> = {
      ...snapshot,
      status: { type: 'running', phase: 'model_completed' },
      currentTurn: nextTurn
    }
    snapshot = modelCompletedSnapshot
    yield* emitEvents(
      await snapshotState(modelCompletedSnapshot, [
        {
          type: 'model_completed',
          runId: snapshot.runId,
          revision: snapshot.revision,
          createdAt: completedAt,
          duration,
          args: modelArgs,
          result: cloneModelResult(callModelResult.result),
          turn: cloneTurn(nextTurn)
        }
      ])
    )
  }

  async function* prepareToolCalls(): AgentEventGenerator {
    const currentTurn = snapshot.currentTurn
    if (!currentTurn?.modelResult) {
      throw new Error('Cannot prepare tool calls without model result.')
    }
    const modelResult = currentTurn.modelResult

    const hookResult = await Effect.runPromise(
      fromAgentResult(() =>
        hooks.onToolCallsStarted?.({
          ...makeBaseArgs(snapshot),
          createdAt: nowIso(),
          result: cloneModelResult(modelResult),
          toolCalls: deepFreeze(
            currentTurn.toolCalls.pending.map(cloneToolCall)
          ),
          turn: cloneTurn(currentTurn)
        })
      )
    )
    const hook = await applyHookResult(hookResult)
    if (hook.events) {
      yield* emitEvents(hook.events)
      return
    }

    const preparedToolCalls = (hook.value ?? currentTurn.toolCalls.pending).map(
      cloneToolCall
    )
    const nextTurn: Turn = {
      ...currentTurn,
      toolCalls: {
        pending: preparedToolCalls,
        inFlight: [],
        completed: []
      }
    }
    const nextSnapshot: AgentRunState<CONTEXT> = {
      ...snapshot,
      status: { type: 'running', phase: 'tool_calls_started' },
      currentTurn: nextTurn
    }
    snapshot = nextSnapshot
    yield* emitEvents(
      await snapshotState(nextSnapshot, [phaseEvent('tool_calls_started')])
    )
  }

  async function* prepareEachToolCall(): AgentEventGenerator {
    const currentTurn = snapshot.currentTurn
    if (!currentTurn) {
      throw new Error('Cannot start tool calls without a current turn.')
    }

    const accepted: AgentToolCall[] = []
    const completed: AgentToolCallResponse[] = [
      ...currentTurn.toolCalls.completed
    ]

    const pendingToolCalls = currentTurn.toolCalls.pending
    for (const [index, originalToolCall] of pendingToolCalls.entries()) {
      const hookToolCall = deepFreeze(cloneToolCall(originalToolCall))
      const hookResult = await Effect.runPromise(
        fromAgentResult(() =>
          hooks.onToolCallStarted?.({
            ...makeBaseArgs(snapshot),
            createdAt: nowIso(),
            toolCall: hookToolCall,
            toolCallId: hookToolCall.toolCallId,
            toolName: hookToolCall.toolName,
            input: hookToolCall.input,
            turn: cloneTurn(snapshot.currentTurn!)
          })
        )
      )
      const hook = await applyHookResult(hookResult, {
        onPause: pause => {
          snapshot = {
            ...snapshot,
            status: { type: 'running', phase: 'tool_calls_started' },
            currentTurn: {
              ...snapshot.currentTurn!,
              toolCalls: {
                pending: [
                  ...accepted,
                  originalToolCall,
                  ...pendingToolCalls.slice(index + 1)
                ],
                inFlight: [],
                completed: [...completed]
              }
            }
          }
          return snapshotPause({
            snapshotter: snapshotState,
            pause,
            snapshot
          })
        }
      })
      if (hook.events) {
        yield* emitEvents(hook.events)
        return
      }
      if (isSkip(hook.value)) {
        completed.push({
          ...hook.value.result,
          toolCallId: originalToolCall.toolCallId,
          toolName: originalToolCall.toolName
        })
      } else {
        accepted.push(cloneToolCall(hook.value ?? originalToolCall))
      }

      const startedSnapshot: AgentRunState<CONTEXT> = {
        ...snapshot,
        status: { type: 'running', phase: 'tool_call_started' },
        currentTurn: {
          ...snapshot.currentTurn!,
          toolCalls: {
            pending: [...accepted],
            inFlight: [],
            completed: [...completed]
          }
        }
      }
      snapshot = startedSnapshot
      yield* emitEvents(
        await snapshotState(startedSnapshot, [phaseEvent('tool_call_started')])
      )
    }
  }

  async function* executePreparedTools(): AgentEventGenerator {
    const currentTurn = snapshot.currentTurn
    if (!currentTurn?.modelArgs) {
      throw new Error('Cannot execute tools without tool snapshot.')
    }

    const launchedToolCalls = currentTurn.toolCalls.pending.map(cloneToolCall)
    const toolMessages: ModelMessage[] =
      'messages' in currentTurn.modelArgs && currentTurn.modelArgs.messages
        ? currentTurn.modelArgs.messages
        : Array.isArray(currentTurn.modelArgs.prompt)
          ? currentTurn.modelArgs.prompt
          : []
    const launchedSnapshot: AgentRunState<CONTEXT> = {
      ...snapshot,
      status: {
        type: 'running',
        phase:
          snapshot.status.type === 'running'
            ? snapshot.status.phase
            : 'tool_call_started'
      },
      currentTurn: {
        ...currentTurn,
        toolCalls: {
          pending: [],
          inFlight: launchedToolCalls,
          completed: [...currentTurn.toolCalls.completed]
        }
      }
    }
    snapshot = launchedSnapshot
    yield* emitEvents(await snapshotState(launchedSnapshot, []))

    const startedAtByToolCall = new Map(
      launchedToolCalls.map(toolCall => [toolCall.toolCallId, nowIso()])
    )
    const results = await Effect.runPromise(
      Effect.all(
        launchedToolCalls.map(toolCall =>
          runMiddleware({
            input: {
              context: snapshot.context,
              messages: toolMessages,
              ...(options.signal ? { signal: options.signal } : {}),
              toolCall: cloneToolCall(toolCall),
              tools
            },
            middleware: options.middleware?.callTool,
            terminal: executeToolCall
          })
        ),
        { concurrency: 'unbounded' }
      )
    )

    for (const response of results) {
      await Effect.runPromise(checkNotAborted(options.signal))
      const completedAt = nowIso()
      const responseResult =
        response.error !== undefined
          ? { error: response.error }
          : { output: response.output }
      const duration = durationMs(
        startedAtByToolCall.get(response.toolCallId) ?? completedAt,
        completedAt
      )

      const turnAfterResponse: Turn = {
        ...snapshot.currentTurn!,
        toolCalls: {
          pending: [],
          inFlight: snapshot.currentTurn!.toolCalls.inFlight.filter(
            toolCall => toolCall.toolCallId !== response.toolCallId
          ),
          completed: [...snapshot.currentTurn!.toolCalls.completed, response]
        }
      }

      const hookResult = await Effect.runPromise(
        fromAgentResult(() =>
          hooks.onToolCallCompleted?.({
            ...makeBaseArgs(snapshot),
            createdAt: completedAt,
            duration,
            toolCallId: response.toolCallId,
            toolName: response.toolName,
            input: response.input,
            turn: cloneTurn(turnAfterResponse),
            ...responseResult
          })
        )
      )
      const hook = await applyHookResult(hookResult)
      if (hook.events) {
        yield* emitEvents(hook.events)
        return
      }

      const completedSnapshot: AgentRunState<CONTEXT> = {
        ...snapshot,
        status: { type: 'running', phase: 'tool_call_completed' },
        currentTurn: turnAfterResponse
      }
      const completionEvent: Extract<
        AgentPhaseEvent,
        { type: 'tool_call_completed' }
      > = {
        type: 'tool_call_completed',
        runId: snapshot.runId,
        revision: snapshot.revision,
        createdAt: completedAt,
        duration,
        turn: cloneTurn(turnAfterResponse),
        toolCallId: response.toolCallId,
        toolName: response.toolName,
        input: response.input,
        ...responseResult
      }
      snapshot = completedSnapshot
      yield* emitEvents(
        await snapshotState(completedSnapshot, [completionEvent])
      )
    }
  }

  async function* completeToolCalls(): AgentEventGenerator {
    const currentTurn = snapshot.currentTurn
    const modelResult = currentTurn?.modelResult
    if (!currentTurn || !modelResult) {
      throw new Error('Cannot complete tool calls without model result.')
    }

    const hookResult = await Effect.runPromise(
      fromAgentResult(() =>
        hooks.onToolCallsCompleted?.({
          ...makeBaseArgs(snapshot),
          createdAt: nowIso(),
          result: cloneModelResult(modelResult),
          toolCalls: currentTurn.toolCalls.completed,
          turn: cloneTurn(currentTurn)
        })
      )
    )
    const hook = await applyHookResult(hookResult)
    if (hook.events) {
      yield* emitEvents(hook.events)
      return
    }

    const completedSnapshot: AgentRunState<CONTEXT> = {
      ...snapshot,
      status: { type: 'running', phase: 'tool_calls_completed' }
    }
    snapshot = completedSnapshot
    yield* emitEvents(
      await snapshotState(completedSnapshot, [
        phaseEvent('tool_calls_completed')
      ])
    )
  }

  async function* completeTurn(): AgentEventGenerator {
    const currentTurn = snapshot.currentTurn
    if (!currentTurn?.modelResult) {
      throw new Error('Cannot complete turn without model result.')
    }

    const completedAt = nowIso()
    const duration = 0
    const completedTurn: Turn = cloneTurn(currentTurn)

    // Record the turn before running the post-completion hook. The turn
    // happened; hook decisions (pause, finish, continue) shouldn't undo it.
    const completedSnapshot: AgentRunState<CONTEXT> = {
      ...snapshot,
      status: { type: 'running', phase: 'turn_completed' },
      turns: [...snapshot.turns, completedTurn],
      currentTurn: undefined
    }
    snapshot = completedSnapshot
    yield* emitEvents(
      await snapshotState(completedSnapshot, [
        {
          type: 'turn_completed',
          runId: snapshot.runId,
          revision: snapshot.revision,
          createdAt: completedAt,
          duration,
          turn: cloneTurn(completedTurn)
        }
      ])
    )

    const hookResult = await Effect.runPromise(
      fromAgentResult(() =>
        hooks.onTurnCompleted?.({
          ...makeBaseArgs(snapshot),
          createdAt: completedAt,
          duration,
          turn: cloneTurn(completedTurn)
        })
      )
    )
    const hook = await applyHookResult(hookResult)
    if (hook.events) {
      yield* emitEvents(hook.events)
      return
    }
  }

  async function* completeRun({
    source,
    reason,
    metadata
  }: {
    source: AgentCompletionSource
    reason?: string
    metadata?: JsonLike
  }): AgentEventGenerator {
    const completedAt = nowIso()
    const duration = durationMs(runCreatedAt, completedAt)
    const turns = snapshot.turns.map(cloneTurn)
    const hookResult = await Effect.runPromise(
      fromAgentResult(() =>
        hooks.onRunCompleted?.({
          ...makeBaseArgs(snapshot),
          createdAt: completedAt,
          duration,
          turns: turns.map(cloneTurn)
        })
      )
    )
    // Inside completeRun, finish is meaningless — we're already finishing.
    // Pause is still honored.
    const hook = await applyHookResult(hookResult, {
      onFinish: 'ignore',
      onContinue: 'ignore'
    })
    if (hook.events) {
      yield* emitEvents(hook.events)
      return
    }

    const completedSnapshot: AgentRunState<CONTEXT> = {
      ...snapshot,
      status: {
        type: 'completed',
        source,
        reason,
        metadata,
        createdAt: completedAt
      }
    }
    snapshot = completedSnapshot
    yield* emitEvents(
      await snapshotState(completedSnapshot, [
        {
          type: 'run_completed',
          runId: snapshot.runId,
          revision: snapshot.revision,
          createdAt: completedAt,
          duration,
          turns: turns.map(cloneTurn),
          source,
          reason,
          metadata
        }
      ])
    )
  }

  async function failRun(error: unknown) {
    const createdAt = nowIso()
    const hookResult = await Effect.runPromise(
      fromAgentResult(() =>
        hooks.onRunFailed?.({
          ...makeBaseArgs(snapshot),
          createdAt,
          error
        })
      )
    )
    snapshot = applyContext({ snapshot, hookResult })
    const failure = serializeError(error)
    const failedSnapshot: AgentRunState<CONTEXT> = {
      ...snapshot,
      status: { type: 'failed', error: failure, createdAt }
    }
    snapshot = failedSnapshot
    return snapshotState(failedSnapshot, [
      {
        type: 'run_failed',
        runId: snapshot.runId,
        revision: snapshot.revision,
        createdAt,
        error: failure
      }
    ])
  }

  try {
    await Effect.runPromise(checkNotAborted(options.signal))

    if (snapshot.status.type === 'paused') {
      const resumedSnapshot: AgentRunState<CONTEXT> = withRunning(
        snapshot,
        snapshot.status.phase
      )
      snapshot = resumedSnapshot
      yield* emitEvents(await snapshotState(resumedSnapshot, []))
    }

    if (
      snapshot.revision === 0 &&
      snapshot.status.type === 'running' &&
      snapshot.status.phase === 'run_started'
    ) {
      const runStartedAt = nowIso()
      const hookResult = await Effect.runPromise(
        fromAgentResult(() =>
          hooks.onRunStarted?.({
            ...makeBaseArgs(snapshot),
            createdAt: runStartedAt
          })
        )
      )
      const hook = await applyHookResult(hookResult)
      if (hook.events) {
        yield* emitEvents(hook.events)
        return
      }

      yield* emitEvents(
        await snapshotState(snapshot, [phaseEvent('run_started')])
      )
    }

    while (snapshot.status.type === 'running') {
      await Effect.runPromise(checkNotAborted(options.signal))

      if (isPaused()) {
        return
      }

      if (pendingFinish) {
        const request = pendingFinish
        pendingFinish = undefined
        yield* completeRun(request)
        continue
      }

      const phase = (snapshot.status as { type: 'running'; phase: AgentPhase })
        .phase
      switch (phase) {
        case 'run_started':
        case 'turn_completed': {
          if (phase === 'turn_completed') {
            const lastTurn = snapshot.turns.at(-1)
            if (!lastTurn?.modelResult) {
              throw new Error(
                'Invalid state: turn_completed without a recorded turn.'
              )
            }
            if (lastTurn.turn >= options.maxTurns) {
              yield* completeRun({
                source: 'max_turns',
                metadata: { maxTurns: options.maxTurns }
              })
              continue
            }
            if (pendingContinue) {
              pendingContinue = false
            } else if (lastTurn.toolCalls.completed.length === 0) {
              yield* completeRun({ source: 'model_done' })
              continue
            }
          }

          const nextTurnNumber = snapshot.turns.length + 1
          const prepared = await prepareTurn(nextTurnNumber)
          yield* emitEvents(prepared.events)
          continue
        }

        case 'turn_started': {
          const prepared = await prepareStartedTurn()
          yield* emitEvents(prepared.events)
          continue
        }

        case 'turn_prepared':
        case 'model_started':
          yield* runModel()
          continue

        case 'model_completed':
          if ((snapshot.currentTurn?.toolCalls.pending.length ?? 0) === 0) {
            yield* completeTurn()
          } else {
            yield* prepareToolCalls()
          }
          continue

        case 'tool_calls_started':
          yield* prepareEachToolCall()
          continue

        case 'tool_call_started':
          if ((snapshot.currentTurn?.toolCalls.pending.length ?? 0) > 0) {
            yield* executePreparedTools()
          } else {
            yield* completeToolCalls()
          }
          continue

        case 'tool_call_completed':
          if ((snapshot.currentTurn?.toolCalls.inFlight.length ?? 0) > 0) {
            throw new Error(
              'Cannot safely resume while tool calls are in flight.'
            )
          }
          yield* completeToolCalls()
          continue

        case 'tool_calls_completed':
          yield* completeTurn()
          continue
      }
    }
  } catch (error) {
    if (options.signal?.aborted) {
      throw error
    }

    yield* emitEvents(await failRun(error))
    throw error
  }
}
