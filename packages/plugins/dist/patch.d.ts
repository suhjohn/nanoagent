import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
type PatchHunk = {
    type: 'add';
    path: string;
    content: string;
} | {
    type: 'delete';
    path: string;
} | {
    type: 'update';
    path: string;
    movePath?: string;
    chunks: UpdateChunk[];
};
type UpdateChunk = {
    context?: string;
    oldLines: string[];
    newLines: string[];
    eof: boolean;
};
export type PatchResult = {
    changedFiles: string[];
    output: string;
};
export declare function withApplyPatchTool<CONTEXT extends JsonLike>(params: {
    root: string;
    toolName?: string;
}): AgentPlugin<CONTEXT>;
export declare function applyPatch(params: {
    root: string;
    patch: string;
}): Promise<PatchResult>;
export declare function parsePatch(patch: string): PatchHunk[];
export {};
