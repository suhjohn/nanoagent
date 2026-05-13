import type {
  AgentToolCallResponse,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
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
  args: ToolCallSite<CONTEXT> & {
    error: unknown
  }
) => unknown | Promise<unknown>
export type ToolResultMapper<CONTEXT extends JsonLike> = (args: {
  response: AgentToolCallResponse
  context: CONTEXT
}) => AgentToolCallResponse | Promise<AgentToolCallResponse>
export type ToolConcurrencyParams<CONTEXT extends JsonLike> = {
  key?: (args: ToolCallSite<CONTEXT>) => string | undefined
}
export declare function withToolPermission<CONTEXT extends JsonLike>(
  check: (
    args: ToolCallSite<CONTEXT>
  ) => ToolPermissionDecision | Promise<ToolPermissionDecision>
): AgentPlugin<CONTEXT>
export declare function withToolResultMapper<CONTEXT extends JsonLike>(
  map: ToolResultMapper<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function withToolErrorBoundary<CONTEXT extends JsonLike>(
  map?: ToolErrorMapper<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function withToolConcurrency<CONTEXT extends JsonLike>(
  params?: ToolConcurrencyParams<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function withVisibleTools<CONTEXT extends JsonLike>(
  select: (args: {
    tools: NonNullable<RunAgentOptions<CONTEXT>['tools']>
  }) => Iterable<string>
): AgentPlugin<CONTEXT>
export {}
