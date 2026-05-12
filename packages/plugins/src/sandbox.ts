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

type SandboxPolicy = { mode: string } & Record<string, unknown>

type ResolvePolicy<CONTEXT extends JsonLike> =
  | SandboxPolicy
  | ((site: ToolCallSite<CONTEXT>) => SandboxPolicy | Promise<SandboxPolicy>)

type SandboxParams<CONTEXT extends JsonLike> = {
  policy: ResolvePolicy<CONTEXT>
  run?: (
    args: ToolCallSite<CONTEXT> & { policy: SandboxPolicy }
  ) => unknown | Promise<unknown>
  retryWithoutSandbox?: (
    args: ToolCallSite<CONTEXT> & { policy: SandboxPolicy; error: unknown }
  ) => boolean | Promise<boolean>
}

export function withSandboxPolicy<CONTEXT extends JsonLike>(
  params: SandboxParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  return appendCallToolMiddleware<CONTEXT>(async ({ input, next }) => {
    const site = toCallSite(input)
    const policy = await resolvePolicy(params.policy, site)

    await params.run?.({ ...site, policy })

    const response = await next(input)
    if (!shouldRetry(response, policy)) return response

    const retry = await params.retryWithoutSandbox?.({
      ...site,
      policy,
      error: response.error
    })
    return retry ? next(input) : response
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

async function resolvePolicy<CONTEXT extends JsonLike>(
  policy: ResolvePolicy<CONTEXT>,
  site: ToolCallSite<CONTEXT>
): Promise<SandboxPolicy> {
  return typeof policy === 'function' ? policy(site) : policy
}

function shouldRetry(
  response: AgentToolCallResponse,
  policy: SandboxPolicy
): response is Extract<AgentToolCallResponse, { error: unknown }> {
  return (
    'error' in response &&
    response.error !== undefined &&
    policy.mode !== 'danger_full_access'
  )
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
