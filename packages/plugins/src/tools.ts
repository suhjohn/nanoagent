// @ts-nocheck

export function withToolPermission(check) {
  return appendCallToolMiddleware(async ({ input, next }) => {
    const decision = await check({
      toolName: input.toolCall.toolName,
      input: input.toolCall.input,
      context: input.context
    })
    if (decision.allow) return next(input)
    return {
      toolCallId: input.toolCall.toolCallId,
      toolName: input.toolCall.toolName,
      input: input.toolCall.input,
      output: decision.output ?? { denied: true, reason: decision.reason }
    }
  })
}

export function withToolResultMapper(map) {
  return appendCallToolMiddleware(async ({ input, next }) =>
    map({ response: await next(input), context: input.context })
  )
}

export function withToolErrorBoundary(map) {
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

export function withToolConcurrency(params) {
  const queues = new Map()
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

export function withVisibleTools(select) {
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

function appendCallToolMiddleware(middleware) {
  return options => ({
    ...options,
    middleware: {
      ...(options.middleware ?? {}),
      callTool: [...(options.middleware?.callTool ?? []), middleware]
    }
  })
}

function resolveQueueKey(params, input) {
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

function acquire(previous) {
  let release = () => {}
  const promise = previous.then(
    () => new Promise(resolve => (release = resolve))
  )
  return {
    promise,
    release: () => release()
  }
}
