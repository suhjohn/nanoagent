import type {
  AgentCallModelResult,
  AgentModelProviders,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
type ModelRetryParams = {
  attempts?: number
  delayMs?: number
  retry?: (error: unknown, attempt: number) => boolean | undefined
}
type ModelResultMap<CONTEXT extends JsonLike> = (args: {
  result: AgentCallModelResult
  context: CONTEXT
}) => AgentCallModelResult | Promise<AgentCallModelResult>
export declare function withModelProviders<CONTEXT extends JsonLike>(
  providers: AgentModelProviders
): AgentPlugin<CONTEXT>
export declare function withModelRetry<CONTEXT extends JsonLike>(
  params?: ModelRetryParams
): AgentPlugin<CONTEXT>
export declare function withModelFallback<CONTEXT extends JsonLike>(
  models: readonly string[]
): AgentPlugin<CONTEXT>
export declare function withModelResultMapper<CONTEXT extends JsonLike>(
  map: ModelResultMap<CONTEXT>
): AgentPlugin<CONTEXT>
export {}
