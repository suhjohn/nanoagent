import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type PermissionAction = 'allow' | 'deny';
export type PermissionRule = {
    permission: string;
    pattern: string;
    action: PermissionAction;
};
export type PermissionRequest = {
    permission: string;
    patterns: string[];
    reason?: string;
};
export type PermissionInferParams<CONTEXT> = {
    toolName: string;
    input: unknown;
    context: CONTEXT;
};
export type PermissionRequestDecision = {
    action: PermissionAction;
    remember?: boolean;
    reason?: string;
};
export type WithPermissionRulesParams<CONTEXT extends JsonLike> = {
    rules: PermissionRule[];
    request: (params: PermissionRequest & {
        context: CONTEXT;
    }) => PermissionRequestDecision | Promise<PermissionRequestDecision>;
    infer?: (params: PermissionInferParams<CONTEXT>) => PermissionRequest;
};
export type GrantPermissionParams<CONTEXT> = PermissionRequest & {
    context?: CONTEXT;
};
export type WithRequestPermissionsToolParams<CONTEXT extends JsonLike> = {
    grant: (params: GrantPermissionParams<CONTEXT>) => unknown;
    toolName?: string;
};
export declare function evaluatePermissionRules(params: {
    rules: PermissionRule[];
    permission: string;
    patterns: string[];
}): PermissionAction | undefined;
export declare function withPermissionRules<CONTEXT extends JsonLike>(params: WithPermissionRulesParams<CONTEXT>): AgentPlugin<CONTEXT>;
export declare function withRequestPermissionsTool<CONTEXT extends JsonLike>(params: WithRequestPermissionsToolParams<CONTEXT>): AgentPlugin<CONTEXT>;
export {};
