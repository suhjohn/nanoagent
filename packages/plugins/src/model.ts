import type {
  AgentCallModelArgs,
  AgentCallModelResult,
  AgentMiddleware,
  AgentModelProviders,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type CallModelMiddleware<CONTEXT extends JsonLike> = AgentMiddleware<
  AgentCallModelArgs<CONTEXT>,
  AgentCallModelResult
>

type ModelRetryParams = {
  attempts?: number
  delayMs?: number
  retry?: (error: unknown, attempt: number) => boolean | undefined
}

type ModelResultMap<CONTEXT extends JsonLike> = (args: {
  result: AgentCallModelResult
  context: CONTEXT
}) => AgentCallModelResult | Promise<AgentCallModelResult>

export function withModelProviders<CONTEXT extends JsonLike>(
  providers: AgentModelProviders
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    modelProviders: { ...(options.modelProviders ?? {}), ...providers }
  })
}

export function withModelRetry<CONTEXT extends JsonLike>(
  params?: ModelRetryParams
): AgentPlugin<CONTEXT> {
  const attempts = params?.attempts ?? 2
  const delayMs = params?.delayMs ?? 0
  const shouldRetry = params?.retry

  return appendCallModelMiddleware<CONTEXT>(async ({ input, next }) => {
    let lastError: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await next(input)
      } catch (error) {
        lastError = error
        const exhausted = attempt === attempts
        const refused = shouldRetry?.(error, attempt) === false
        if (exhausted || refused) throw error
        if (delayMs > 0) await sleep(delayMs)
      }
    }
    throw lastError
  })
}

export function withModelFallback<CONTEXT extends JsonLike>(
  models: readonly string[]
): AgentPlugin<CONTEXT> {
  return appendCallModelMiddleware<CONTEXT>(async ({ input, next }) => {
    if (!models.length) return next(input)
    let lastError: unknown
    for (const model of models) {
      try {
        return await next({ ...input, args: { ...input.args, model } })
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  })
}

export function withModelResultMapper<CONTEXT extends JsonLike>(
  map: ModelResultMap<CONTEXT>
): AgentPlugin<CONTEXT> {
  return appendCallModelMiddleware<CONTEXT>(async ({ input, next }) =>
    map({ result: await next(input), context: input.context as CONTEXT })
  )
}

function appendCallModelMiddleware<CONTEXT extends JsonLike>(
  middleware: CallModelMiddleware<CONTEXT>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    middleware: {
      ...(options.middleware ?? {}),
      callModel: [...(options.middleware?.callModel ?? []), middleware]
    }
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
