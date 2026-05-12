import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
type ProjectContextParams = {
    cwd: string;
    agentDir?: string;
};
export declare function withProjectContext<CONTEXT extends JsonLike>(params: ProjectContextParams): AgentPlugin<CONTEXT>;
export {};
