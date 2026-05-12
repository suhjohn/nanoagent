import type {
  AgentCallToolArgs,
  AgentToolCallResponse,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolCallSite<CONTEXT extends JsonLike> = {
  toolName: string
  input: unknown
  context: CONTEXT
}

type SuccessResponse = Extract<AgentToolCallResponse, { output: unknown }>
type ErrorResponse = Extract<AgentToolCallResponse, { error: unknown }>

type Snapshotter<CONTEXT extends JsonLike, SNAPSHOT> = {
  capture: (site: ToolCallSite<CONTEXT>) => Promise<SNAPSHOT> | SNAPSHOT
  restore?: (
    args: ToolCallSite<CONTEXT> & { snapshot: SNAPSHOT; error: unknown }
  ) => unknown | Promise<unknown>
  diff?: (
    args: ToolCallSite<CONTEXT> & { snapshot: SNAPSHOT; output: unknown }
  ) => unknown | Promise<unknown>
}

export function withSnapshots<CONTEXT extends JsonLike, SNAPSHOT>(
  snapshotter: Snapshotter<CONTEXT, SNAPSHOT>
): AgentPlugin<CONTEXT> {
  return appendCallToolMiddleware<CONTEXT>(async ({ input, next }) => {
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
    return attachDiff(response, await snapshotter.diff({
      ...site,
      snapshot,
      output: response.output
    }))
  })
}

function toCallSite<CONTEXT extends JsonLike>(
  input: AgentCallToolArgs<CONTEXT>
): ToolCallSite<CONTEXT> {
  return {
    toolName: input.toolCall.toolName,
    input: input.toolCall.input,
    context: input.context
  }
}

function isErrorResponse(
  response: AgentToolCallResponse
): response is ErrorResponse {
  return 'error' in response && response.error !== undefined
}

function attachDiff(response: SuccessResponse, diff: unknown): SuccessResponse {
  return {
    toolCallId: response.toolCallId,
    toolName: response.toolName,
    input: response.input,
    output: { value: response.output, diff }
  }
}

function appendCallToolMiddleware<CONTEXT extends JsonLike>(
  middleware: NonNullable<
    NonNullable<RunAgentOptions<CONTEXT>['middleware']>['callTool']
  >[number]
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    middleware: {
      ...options.middleware,
      callTool: [...(options.middleware?.callTool ?? []), middleware]
    }
  })
}
