import type { AgentHooks, AgentMiddlewareMap, AgentModelProviders, AgentSaveState, JsonLike, RunAgentOptions } from '@nanoagent/kernel';
export type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT> | Promise<RunAgentOptions<CONTEXT>>;
export declare function withPlugins<CONTEXT extends JsonLike>(options: RunAgentOptions<CONTEXT>, plugins: readonly AgentPlugin<CONTEXT>[]): Promise<RunAgentOptions<CONTEXT>>;
export declare function withTools<CONTEXT extends JsonLike>(tools: NonNullable<RunAgentOptions<CONTEXT>['tools']>): AgentPlugin<CONTEXT>;
export declare function withModelProviders<CONTEXT extends JsonLike>(modelProviders: AgentModelProviders): AgentPlugin<CONTEXT>;
export declare function withHooks<CONTEXT extends JsonLike>(hooks: Partial<AgentHooks<CONTEXT>>): AgentPlugin<CONTEXT>;
export declare function withMiddleware<CONTEXT extends JsonLike>(middleware: AgentMiddlewareMap<CONTEXT>): AgentPlugin<CONTEXT>;
export declare function withSaveState<CONTEXT extends JsonLike>(saveState: AgentSaveState<CONTEXT>): AgentPlugin<CONTEXT>;
