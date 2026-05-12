import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export declare function withCodingTools<CONTEXT extends JsonLike>(params: {
    cwd: string;
    enabled?: readonly ('read' | 'write' | 'list' | 'grep' | 'shell' | 'patch')[];
}): AgentPlugin<CONTEXT>;
export {};
