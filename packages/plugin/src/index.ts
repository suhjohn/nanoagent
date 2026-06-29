import type {
  AgentEffectResult,
  AgentHooks,
  AgentMiddlewareMap,
  AgentModelProviders,
  AgentSaveState,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'
import { Effect } from 'effect'

function fromAgentResult<A>(
  evaluate: () => AgentEffectResult<A, Error> | undefined
): any {
  return Effect.flatMap(
    Effect.try({
      try: evaluate,
      catch: e => (e instanceof Error ? e : new Error(String(e)))
    }),
    result =>
      Effect.isEffect(result)
        ? result
        : Effect.tryPromise({
            try: () => Promise.resolve(result as A | PromiseLike<A>),
            catch: e => (e instanceof Error ? e : new Error(String(e)))
          })
  )
}

export type AgentPlugin<CONTEXT extends JsonLike> = {
  name?: string
  tools?: NonNullable<RunAgentOptions<CONTEXT>['tools']>
  modelProviders?: AgentModelProviders
  hooks?: Partial<AgentHooks<CONTEXT>>
  middleware?: AgentMiddlewareMap<CONTEXT>
  saveState?: AgentSaveState<CONTEXT>
}

type HookResult = {
  context?: JsonLike
  value?: unknown
  control?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHookResult(value: unknown): value is HookResult {
  return typeof value === 'object' && value !== null
}

function hasControl(
  value: unknown
): value is HookResult & { control: unknown } {
  return isHookResult(value) && value.control !== undefined
}

function hasContext(
  value: unknown
): value is HookResult & { context: JsonLike } {
  return isHookResult(value) && value.context !== undefined
}

function hasValue(value: unknown): value is HookResult & { value: unknown } {
  return isHookResult(value) && value.value !== undefined
}

function mergeContext(current: unknown, patch: JsonLike): JsonLike {
  if (Array.isArray(patch)) {
    return patch
  }
  if (isRecord(current) && isRecord(patch)) {
    return { ...current, ...patch } as JsonLike
  }
  return patch
}

function turnWithModelArgs(turn: unknown, value: unknown) {
  if (!isRecord(turn) || !isRecord(value) || !('model' in value)) {
    return turn
  }

  const currentModelArgs = isRecord(turn.modelArgs) ? turn.modelArgs : {}
  const toolNames = Array.isArray(currentModelArgs.toolNames)
    ? currentModelArgs.toolNames
    : []

  return {
    ...turn,
    modelArgs: {
      ...value,
      toolNames
    }
  }
}

function argsWithHookResult(args: unknown, result: unknown) {
  if (!isHookResult(result) || !isRecord(args)) {
    return args
  }

  let nextArgs = args
  if (hasContext(result)) {
    nextArgs = {
      ...nextArgs,
      context: mergeContext(nextArgs.context, result.context)
    }
  }
  if (hasValue(result)) {
    nextArgs = {
      ...nextArgs,
      turn: turnWithModelArgs(nextArgs.turn, result.value)
    }
  }

  return nextArgs
}

function mergeHookResults(first: unknown, second: unknown) {
  if (!isHookResult(first)) {
    return second
  }

  if (!isHookResult(second)) {
    return first
  }

  return {
    ...(hasContext(first) ? { context: first.context } : {}),
    ...(hasValue(first) ? { value: first.value } : {}),
    ...(hasControl(first) ? { control: first.control } : {}),
    ...(hasContext(second) ? { context: second.context } : {}),
    ...(hasValue(second) ? { value: second.value } : {}),
    ...(hasControl(second) ? { control: second.control } : {})
  }
}

function chainHook<HOOK extends (args: never) => unknown>(
  first: HOOK | undefined,
  second: HOOK | undefined
): HOOK | undefined {
  if (!first) {
    return second
  }

  if (!second) {
    return first
  }

  return ((args: Parameters<HOOK>[0]) => {
    return Effect.gen(function* () {
      const firstResultRaw = first(args) as ReturnType<HOOK>
      const firstResult = yield* fromAgentResult(() => firstResultRaw as any)
      if (hasControl(firstResult)) {
        return firstResult
      }

      const nextArgs = argsWithHookResult(
        args,
        firstResult
      ) as Parameters<HOOK>[0]

      const secondResultRaw = second(nextArgs)
      const secondResult = yield* fromAgentResult(() => secondResultRaw as any)

      // If the second hook returns context, merge it onto the context
      // the first hook returned, rather than overwriting it completely.
      let finalContext = firstResult.context
      if (hasContext(secondResult)) {
        finalContext = Array.isArray(secondResult.context)
          ? secondResult.context
          : typeof secondResult.context === 'object' &&
              secondResult.context !== null
            ? {
                ...((firstResult.context as any) ?? {}),
                ...(secondResult.context as any)
              }
            : secondResult.context
      }

      return mergeHookResults(
        hasContext(firstResult)
          ? { ...firstResult, context: finalContext }
          : firstResult,
        hasContext(secondResult)
          ? { ...secondResult, context: finalContext }
          : secondResult
      )
    })
  }) as unknown as HOOK
}

function chainHooks<CONTEXT extends JsonLike>(
  first: AgentHooks<CONTEXT>,
  second: Partial<AgentHooks<CONTEXT>>
): AgentHooks<CONTEXT> {
  return {
    onRunStarted: chainHook(first.onRunStarted, second.onRunStarted),
    onTurnStarted: chainHook(first.onTurnStarted, second.onTurnStarted),
    onTurnPrepared: chainHook(first.onTurnPrepared, second.onTurnPrepared)!,
    onModelStarted: chainHook(first.onModelStarted, second.onModelStarted),
    onModelRestarted: chainHook(
      first.onModelRestarted,
      second.onModelRestarted
    ),
    onModelCompleted: chainHook(
      first.onModelCompleted,
      second.onModelCompleted
    ),
    onPause: chainHook(first.onPause, second.onPause),
    onStreamUpdate: chainHook(first.onStreamUpdate, second.onStreamUpdate),
    onToolCallsStarted: chainHook(
      first.onToolCallsStarted,
      second.onToolCallsStarted
    ),
    onToolCallStarted: chainHook(
      first.onToolCallStarted,
      second.onToolCallStarted
    ),
    onToolCallCompleted: chainHook(
      first.onToolCallCompleted,
      second.onToolCallCompleted
    ),
    onToolCallsCompleted: chainHook(
      first.onToolCallsCompleted,
      second.onToolCallsCompleted
    ),
    onTurnCompleted: chainHook(first.onTurnCompleted, second.onTurnCompleted),
    onRunCompleted: chainHook(first.onRunCompleted, second.onRunCompleted),
    onRunFailed: chainHook(first.onRunFailed, second.onRunFailed)
  }
}

function mergeMiddleware<CONTEXT extends JsonLike>(
  first: AgentMiddlewareMap<CONTEXT> | undefined,
  second: AgentMiddlewareMap<CONTEXT>
): AgentMiddlewareMap<CONTEXT> {
  return {
    callModel: [...(first?.callModel ?? []), ...(second.callModel ?? [])],
    callTool: [...(first?.callTool ?? []), ...(second.callTool ?? [])]
  }
}

export function withPlugins<CONTEXT extends JsonLike>(
  options: RunAgentOptions<CONTEXT>,
  plugins: readonly AgentPlugin<CONTEXT>[]
): RunAgentOptions<CONTEXT> {
  let next = { ...options }

  for (const plugin of plugins) {
    if (plugin.tools) {
      next.tools = { ...(next.tools ?? {}), ...plugin.tools }
    }
    if (plugin.modelProviders) {
      next.modelProviders = {
        ...(next.modelProviders ?? {}),
        ...plugin.modelProviders
      }
    }
    if (plugin.hooks) {
      next.hooks = chainHooks(next.hooks, plugin.hooks)
    }
    if (plugin.middleware) {
      next.middleware = mergeMiddleware(next.middleware, plugin.middleware)
    }
    if (plugin.saveState) {
      next.saveState = plugin.saveState
    }
  }

  return next
}

export * from './plugins/session'
export * from './plugins/skills'
