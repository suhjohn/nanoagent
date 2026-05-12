import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
import { withPermissionRules, type PermissionRule } from './permissions.js';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type PluginConfig = {
    cwd?: string;
    permissions?: PermissionRule[];
    tools?: Array<'read' | 'write' | 'list' | 'grep' | 'shell' | 'patch'>;
    projectContext?: boolean;
};
export declare function loadPluginConfig(filePath: string): Promise<PluginConfig>;
export declare function pluginsFromConfig<CONTEXT extends JsonLike>(params: {
    config: PluginConfig;
    askPermission: Parameters<typeof withPermissionRules<CONTEXT>>[0]['request'];
}): AgentPlugin<CONTEXT>;
export {};
