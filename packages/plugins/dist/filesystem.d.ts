import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type FilesystemPluginOptions = {
    root: string;
    readToolName?: string;
    writeToolName?: string;
    editToolName?: string;
    listToolName?: string;
    grepToolName?: string;
};
export declare function withFilesystemTools<CONTEXT extends JsonLike>(options: FilesystemPluginOptions): AgentPlugin<CONTEXT>;
export {};
