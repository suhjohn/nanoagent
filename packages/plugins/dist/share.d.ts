import type { AgentPhaseEvent, AgentRunState, JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type Awaitable<A> = A | Promise<A>;
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type ShareSyncPayload<CONTEXT extends JsonLike> = {
    state: AgentRunState<CONTEXT>;
    events: AgentPhaseEvent[];
    context: CONTEXT;
};
export type ShareClient<CONTEXT extends JsonLike> = {
    sync: (payload: ShareSyncPayload<CONTEXT>) => Awaitable<void>;
};
export type ShareSyncParams<CONTEXT extends JsonLike> = {
    client: ShareClient<CONTEXT>;
    debounceMs?: number;
};
export declare function withShareSync<CONTEXT extends JsonLike>(params: ShareSyncParams<CONTEXT>): AgentPlugin<CONTEXT>;
export {};
