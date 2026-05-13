import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
type RevertStore<CONTEXT extends JsonLike> = {
    revert: (args: {
        sessionId: string;
        messageId: string;
        partId?: string;
        context: CONTEXT | undefined;
    }) => unknown | Promise<unknown>;
    unrevert: (args: {
        sessionId: string;
        context: CONTEXT | undefined;
    }) => unknown | Promise<unknown>;
};
type RevertParams<CONTEXT extends JsonLike> = {
    store: RevertStore<CONTEXT>;
};
export declare function withRevertTools<CONTEXT extends JsonLike>(params: RevertParams<CONTEXT>): AgentPlugin<CONTEXT>;
export {};
