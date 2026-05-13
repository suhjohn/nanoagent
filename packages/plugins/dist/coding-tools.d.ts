import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type CodingTool = 'read' | 'write' | 'list' | 'grep' | 'shell' | 'patch';
export declare function withCodingTools<CONTEXT extends JsonLike>(params: {
    cwd: string;
    enabled?: readonly CodingTool[];
}): AgentPlugin<CONTEXT>;
export {};
