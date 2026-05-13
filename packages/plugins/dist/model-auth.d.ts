import type { AgentModelProviders, JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type Awaitable<A> = A | Promise<A>;
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type ModelAuthStore = {
    apiKey(provider: string): Awaitable<string | undefined>;
    oauthToken?(provider: string): Awaitable<string | undefined>;
};
type ApplyAuth = (args: {
    provider: string;
    token: string;
}) => Awaitable<void>;
export declare function createEnvModelAuthStore(env?: Record<string, string | undefined>): ModelAuthStore;
export declare function createMemoryModelAuthStore(params: {
    apiKeys?: Record<string, string>;
    oauthTokens?: Record<string, string>;
}): ModelAuthStore;
export declare function withModelAuth<CONTEXT extends JsonLike>(params: {
    providers?: AgentModelProviders;
    auth: ModelAuthStore;
    apply?: ApplyAuth;
}): AgentPlugin<CONTEXT>;
export {};
