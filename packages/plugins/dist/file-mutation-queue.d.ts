import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export declare function withFileMutationQueue<CONTEXT extends JsonLike>(params?: {
    toolNames?: readonly string[];
    path?: (input: unknown) => string | undefined;
}): AgentPlugin<CONTEXT>;
export {};
