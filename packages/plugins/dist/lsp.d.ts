import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type Awaitable<A> = A | Promise<A>;
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
declare const LSP_OPERATIONS: readonly ["goToDefinition", "findReferences", "hover", "documentSymbol", "workspaceSymbol", "goToImplementation", "prepareCallHierarchy", "incomingCalls", "outgoingCalls"];
export type LspOperation = (typeof LSP_OPERATIONS)[number];
export type LspDiagnosticMode = 'none' | 'document';
export type LspClient = {
    hasClient(file: string): Awaitable<boolean>;
    touchFile?(file: string, diagnostics?: LspDiagnosticMode): Awaitable<void>;
    operation(args: {
        operation: LspOperation;
        file: string;
        uri: string;
        line: number;
        character: number;
        query?: string;
    }): Awaitable<unknown[]>;
    diagnostics?(file: string): Awaitable<unknown[]>;
    close?(): Awaitable<void>;
};
export type LspServerConfig = {
    id: string;
    command: readonly string[];
    extensions?: readonly string[];
    languageId?: string;
    rootMarkers?: readonly string[];
    initializationOptions?: unknown;
    settings?: unknown;
    env?: NodeJS.ProcessEnv;
};
export type NodeLspClientParams = {
    cwd: string;
    servers: readonly LspServerConfig[];
    env?: NodeJS.ProcessEnv;
    requestTimeoutMs?: number;
    diagnosticsTimeoutMs?: number;
};
export declare function withLspTool<CONTEXT extends JsonLike>(params: {
    cwd: string;
    client?: LspClient;
    servers?: readonly LspServerConfig[];
    requestTimeoutMs?: number;
    diagnosticsTimeoutMs?: number;
    toolName?: string;
}): AgentPlugin<CONTEXT>;
export declare function createNodeLspClient(params: NodeLspClientParams): LspClient;
export declare function diagnosticsAfterEdit(client: LspClient, file: string): Promise<unknown[]>;
export {};
