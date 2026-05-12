import type { AgentModelProviders, JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type Awaitable<A> = A | Promise<A>;
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type ModelAuthStore = {
    apiKey(provider: string): Awaitable<string | undefined>;
    oauthToken?(provider: string): Awaitable<string | undefined>;
};
export declare function withModelAuth<CONTEXT extends JsonLike>(params: {
    providers?: AgentModelProviders;
    auth: ModelAuthStore;
    apply?: (args: {
        provider: string;
        token: string;
    }) => Awaitable<void>;
}): AgentPlugin<CONTEXT>;
export {};
