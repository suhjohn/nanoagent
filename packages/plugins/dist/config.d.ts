import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
import { type PermissionRequestDecision, type PermissionRule } from './permissions.js';
import { type CodingTool } from './coding-tools.js';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type PluginConfig = {
    cwd?: string;
    permissions?: PermissionRule[];
    tools?: CodingTool[];
    projectContext?: boolean;
};
export declare function loadPluginConfig(filePath: string): Promise<PluginConfig>;
export declare function pluginsFromConfig<CONTEXT extends JsonLike>(params: {
    config: PluginConfig;
    askPermission: (params: {
        permission: string;
        patterns: string[];
        reason?: string;
        context: CONTEXT;
    }) => PermissionRequestDecision | Promise<PermissionRequestDecision>;
}): AgentPlugin<CONTEXT>;
export {};
