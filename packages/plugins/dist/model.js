export function withModelProviders(providers) {
  return options => ({
    ...options,
    modelProviders: { ...(options.modelProviders ?? {}), ...providers }
  })
}
export function withModelRetry(params) {
  const attempts = params?.attempts ?? 2
  const delayMs = params?.delayMs ?? 0
  const shouldRetry = params?.retry
  return appendCallModelMiddleware(async ({ input, next }) => {
    let lastError
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
export function withModelFallback(models) {
  return appendCallModelMiddleware(async ({ input, next }) => {
    if (!models.length) return next(input)
    let lastError
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
export function withModelResultMapper(map) {
  return appendCallModelMiddleware(async ({ input, next }) =>
    map({ result: await next(input), context: input.context })
  )
}
function appendCallModelMiddleware(middleware) {
  return options => ({
    ...options,
    middleware: {
      ...(options.middleware ?? {}),
      callModel: [...(options.middleware?.callModel ?? []), middleware]
    }
  })
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
