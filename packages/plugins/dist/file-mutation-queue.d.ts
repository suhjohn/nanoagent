import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
type PathExtractor = (input: unknown) => string | undefined
export declare function withFileMutationQueue<
  CONTEXT extends JsonLike
>(params?: {
  toolNames?: readonly string[]
  path?: PathExtractor
}): AgentPlugin<CONTEXT>
export {}
