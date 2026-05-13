import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type Awaitable<A> = A | Promise<A>;
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
type ToolSet<CONTEXT extends JsonLike> = NonNullable<RunAgentOptions<CONTEXT>['tools']>;
type JsonSchema = {
    type: 'string';
    description?: string;
    enum?: readonly string[];
} | {
    type: 'number';
    description?: string;
    minimum?: number;
    maximum?: number;
} | {
    type: 'integer';
    description?: string;
    minimum?: number;
    maximum?: number;
} | {
    type: 'boolean';
    description?: string;
} | {
    type: 'array';
    description?: string;
    items: JsonSchema;
    minItems?: number;
    maxItems?: number;
} | {
    type: 'object';
    description?: string;
    properties: Record<string, JsonSchema>;
    required?: readonly string[];
    additionalProperties?: boolean;
};
export type McpTool = {
    server: string;
    name: string;
    description?: string;
    inputSchema?: JsonSchema;
};
export type McpResource = {
    uri: string;
    name?: string;
    description?: string;
};
export type McpClient = {
    listTools(): Awaitable<readonly McpTool[]>;
    callTool(args: {
        server: string;
        name: string;
        input: unknown;
    }): Awaitable<unknown>;
    listResources?(): Awaitable<readonly McpResource[]>;
    readResource?(uri: string): Awaitable<unknown>;
};
export declare function createMcpTools<CONTEXT extends JsonLike>(client: McpClient): Promise<ToolSet<CONTEXT>>;
export declare function withMcpTools<CONTEXT extends JsonLike>(client: McpClient): Promise<AgentPlugin<CONTEXT>>;
export declare function mcpToolName(server: string, tool: string): string;
export {};
