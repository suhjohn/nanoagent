import type {
  AgentHooks,
  AgentMiddlewareMap,
  AgentModelProviders,
  AgentSaveState,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

export type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT> | Promise<RunAgentOptions<CONTEXT>>

type HookResult = {
  context?: JsonLike
  value?: unknown
  control?: unknown
}

function isHookResult(value: unknown): value is HookResult {
  return typeof value === 'object' && value !== null
}

function hasControl(value: unknown): value is HookResult & { control: unknown } {
  return isHookResult(value) && value.control !== undefined
}

function hasContext(value: unknown): value is HookResult & { context: JsonLike } {
  return isHookResult(value) && value.context !== undefined
}

function hasValue(value: unknown): value is HookResult & { value: unknown } {
  return isHookResult(value) && value.value !== undefined
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

  return (async (args: Parameters<HOOK>[0]) => {
    const firstResult = await first(args)
    if (hasControl(firstResult)) {
      return firstResult
    }

    const secondArgs = hasContext(firstResult)
      ? Object.assign({}, args, { context: firstResult.context })
      : args
    const secondResult = await second(secondArgs as Parameters<HOOK>[0])
    return mergeHookResults(firstResult, secondResult)
  }) as HOOK
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

export async function withPlugins<CONTEXT extends JsonLike>(
  options: RunAgentOptions<CONTEXT>,
  plugins: readonly AgentPlugin<CONTEXT>[]
) {
  let next = options

  for (const plugin of plugins) {
    next = await plugin(next)
  }

  return next
}

export function withTools<CONTEXT extends JsonLike>(
  tools: NonNullable<RunAgentOptions<CONTEXT>['tools']>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    tools: {
      ...(options.tools ?? {}),
      ...tools
    }
  })
}

export function withModelProviders<CONTEXT extends JsonLike>(
  modelProviders: AgentModelProviders
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    modelProviders: {
      ...(options.modelProviders ?? {}),
      ...modelProviders
    }
  })
}

export function withHooks<CONTEXT extends JsonLike>(
  hooks: Partial<AgentHooks<CONTEXT>>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    hooks: chainHooks(options.hooks, hooks)
  })
}

export function withMiddleware<CONTEXT extends JsonLike>(
  middleware: AgentMiddlewareMap<CONTEXT>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    middleware: mergeMiddleware(options.middleware, middleware)
  })
}

export function withSaveState<CONTEXT extends JsonLike>(
  saveState: AgentSaveState<CONTEXT>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    saveState
  })
}
