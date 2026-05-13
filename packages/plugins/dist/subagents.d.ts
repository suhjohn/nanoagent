import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type SubagentInputItem = {
    type: 'text';
    text: string;
} | {
    type: 'image';
    image_url: string;
} | {
    type: 'local_image';
    path: string;
} | {
    type: 'skill';
    name?: string;
    path?: string;
} | {
    type: 'mention';
    name?: string;
    path?: string;
};
export type SubagentSpawnInput = {
    message?: string;
    items?: SubagentInputItem[];
    agentType?: string;
    forkContext?: boolean;
    model?: string;
    reasoningEffort?: string;
};
export type SubagentHost<CONTEXT extends JsonLike> = {
    spawn: (params: SubagentSpawnInput & {
        context?: CONTEXT;
    }) => unknown;
    send: (params: {
        target: string;
        message?: string;
        items?: SubagentInputItem[];
        interrupt: boolean;
        context?: CONTEXT;
    }) => unknown;
    wait: (params: {
        targets: string[];
        timeoutMs: number;
        context?: CONTEXT;
    }) => unknown;
    resume: (params: {
        id: string;
        context?: CONTEXT;
    }) => unknown;
    close: (params: {
        target: string;
        context?: CONTEXT;
    }) => unknown;
};
export declare function withSubagentTools<CONTEXT extends JsonLike>(host: SubagentHost<CONTEXT>): AgentPlugin<CONTEXT>;
export {};
