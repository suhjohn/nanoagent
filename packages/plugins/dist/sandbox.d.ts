import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
type ToolCallSite<CONTEXT extends JsonLike> = {
    toolName: string;
    input: unknown;
    context: CONTEXT;
};
type SandboxPolicy = {
    mode: string;
} & Record<string, unknown>;
type ResolvePolicy<CONTEXT extends JsonLike> = SandboxPolicy | ((site: ToolCallSite<CONTEXT>) => SandboxPolicy | Promise<SandboxPolicy>);
type SandboxParams<CONTEXT extends JsonLike> = {
    policy: ResolvePolicy<CONTEXT>;
    run?: (args: ToolCallSite<CONTEXT> & {
        policy: SandboxPolicy;
    }) => unknown | Promise<unknown>;
    retryWithoutSandbox?: (args: ToolCallSite<CONTEXT> & {
        policy: SandboxPolicy;
        error: unknown;
    }) => boolean | Promise<boolean>;
};
export declare function withSandboxPolicy<CONTEXT extends JsonLike>(params: SandboxParams<CONTEXT>): AgentPlugin<CONTEXT>;
export {};
