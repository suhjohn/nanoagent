export function withSnapshots(snapshotter) {
  return appendCallToolMiddleware(async ({ input, next }) => {
    const site = toCallSite(input)
    const snapshot = await snapshotter.capture(site)
    const response = await next(input)
    if (isErrorResponse(response)) {
      await snapshotter.restore?.({
        ...site,
        snapshot,
        error: response.error
      })
      return response
    }
    if (!snapshotter.diff) return response
    return attachDiff(
      response,
      await snapshotter.diff({
        ...site,
        snapshot,
        output: response.output
      })
    )
  })
}
function toCallSite(input) {
  return {
    toolName: input.toolCall.toolName,
    input: input.toolCall.input,
    context: input.context
  }
}
function isErrorResponse(response) {
  return 'error' in response && response.error !== undefined
}
function attachDiff(response, diff) {
  return {
    toolCallId: response.toolCallId,
    toolName: response.toolName,
    input: response.input,
    output: { value: response.output, diff }
  }
}
function appendCallToolMiddleware(middleware) {
  return options => ({
    ...options,
    middleware: {
      ...options.middleware,
      callTool: [...(options.middleware?.callTool ?? []), middleware]
    }
  })
}
