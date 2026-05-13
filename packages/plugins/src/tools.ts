// Origin:
// - OpenCode: packages/opencode/src/tool/tool.ts, tool/registry.ts
// - Codex: codex-rs/core/src/tools/orchestrator.rs
// Behavior: tool middleware for permission gating, result mapping, error mapping, concurrency, and visibility.
import type {
  AgentCallToolArgs,
  AgentMiddleware,
  AgentToolCallResponse,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolMiddleware<CONTEXT extends JsonLike> = AgentMiddleware<
  AgentCallToolArgs<CONTEXT>,
  AgentToolCallResponse
>

export type ToolCallSite<CONTEXT extends JsonLike> = {
  toolName: string
  input: unknown
  context: CONTEXT
}

export type ToolPermissionDecision = {
  allow: boolean
  reason?: string
  output?: unknown
}

export type ToolErrorMapper<CONTEXT extends JsonLike> = (
  args: ToolCallSite<CONTEXT> & { error: unknown }
) => unknown | Promise<unknown>

export type ToolResultMapper<CONTEXT extends JsonLike> = (args: {
  response: AgentToolCallResponse
  context: CONTEXT
}) => AgentToolCallResponse | Promise<AgentToolCallResponse>

export type ToolConcurrencyParams<CONTEXT extends JsonLike> = {
  key?: (args: ToolCallSite<CONTEXT>) => string | undefined
}

export function withToolPermission<CONTEXT extends JsonLike>(
  check: (
    args: ToolCallSite<CONTEXT>
  ) => ToolPermissionDecision | Promise<ToolPermissionDecision>
): AgentPlugin<CONTEXT> {
  return appendCallToolMiddleware(async ({ input, next }) => {
    const decision = await check({
      toolName: input.toolCall.toolName,
      input: input.toolCall.input,
      context: input.context
    })
    if (decision.allow) return next(input)
    const output = decision.output ?? { denied: true, reason: decision.reason }
    return {
      toolCallId: input.toolCall.toolCallId,
      toolName: input.toolCall.toolName,
      input: input.toolCall.input,
      output
    }
  })
}

export function withToolResultMapper<CONTEXT extends JsonLike>(
  map: ToolResultMapper<CONTEXT>
): AgentPlugin<CONTEXT> {
  return appendCallToolMiddleware(async ({ input, next }) =>
    map({ response: await next(input), context: input.context })
  )
}

export function withToolErrorBoundary<CONTEXT extends JsonLike>(
  map?: ToolErrorMapper<CONTEXT>
): AgentPlugin<CONTEXT> {
  return appendCallToolMiddleware(async ({ input, next }) => {
    try {
      return await next(input)
    } catch (error) {
      return {
        toolCallId: input.toolCall.toolCallId,
        toolName: input.toolCall.toolName,
        input: input.toolCall.input,
        error: map
          ? await map({
              error,
              toolName: input.toolCall.toolName,
              input: input.toolCall.input,
              context: input.context
            })
          : error
      }
    }
  })
}

export function withToolConcurrency<CONTEXT extends JsonLike>(
  params: ToolConcurrencyParams<CONTEXT> = {}
): AgentPlugin<CONTEXT> {
  const queues = new Map<string, Promise<void>>()
  return appendCallToolMiddleware(async ({ input, next }) => {
    const key = resolveQueueKey(params, input)
    const previous = queues.get(key) ?? Promise.resolve()
    const slot = acquire(previous)
    queues.set(key, slot.promise)
    await previous
    try {
      return await next(input)
    } finally {
      slot.release()
      if (queues.get(key) === slot.promise) queues.delete(key)
    }
  })
}

export function withVisibleTools<CONTEXT extends JsonLike>(
  select: (args: {
    tools: NonNullable<RunAgentOptions<CONTEXT>['tools']>
  }) => Iterable<string>
): AgentPlugin<CONTEXT> {
  return options => {
    const tools = options.tools ?? {}
    const selected = new Set(select({ tools }))
    return {
      ...options,
      tools: Object.fromEntries(
        Object.entries(tools).filter(([name]) => selected.has(name))
      )
    }
  }
}

function appendCallToolMiddleware<CONTEXT extends JsonLike>(
  middleware: ToolMiddleware<CONTEXT>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    middleware: {
      ...(options.middleware ?? {}),
      callTool: [...(options.middleware?.callTool ?? []), middleware]
    }
  })
}

function resolveQueueKey<CONTEXT extends JsonLike>(
  params: ToolConcurrencyParams<CONTEXT>,
  input: AgentCallToolArgs<CONTEXT>
) {
  const compute = params?.key
  if (!compute) return input.toolCall.toolName
  return (
    compute({
      toolName: input.toolCall.toolName,
      input: input.toolCall.input,
      context: input.context
    }) ?? input.toolCall.toolName
  )
}

function acquire(previous: Promise<void>) {
  let release = () => {}
  const promise = previous.then(
    () => new Promise<void>(resolve => (release = resolve))
  )
  return {
    promise,
    release: () => release()
  }
}
