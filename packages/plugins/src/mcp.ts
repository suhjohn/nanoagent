// Origin:
// - Codex: codex-rs/core/src/session/mcp.rs, mcp_tool_call.rs, tools/handlers/mcp.rs, mcp_resource.rs
// Behavior: discover MCP tools/resources, namespace tool names, call remote tools, and expose resource reads.
import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type Awaitable<A> = A | Promise<A>

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolSet<CONTEXT extends JsonLike> = NonNullable<
  RunAgentOptions<CONTEXT>['tools']
>

type Tool<CONTEXT extends JsonLike> = ToolSet<CONTEXT>[string]

type JsonSchema =
  | { type: 'string'; description?: string; enum?: readonly string[] }
  | { type: 'number'; description?: string; minimum?: number; maximum?: number }
  | {
      type: 'integer'
      description?: string
      minimum?: number
      maximum?: number
    }
  | { type: 'boolean'; description?: string }
  | {
      type: 'array'
      description?: string
      items: JsonSchema
      minItems?: number
      maxItems?: number
    }
  | {
      type: 'object'
      description?: string
      properties: Record<string, JsonSchema>
      required?: readonly string[]
      additionalProperties?: boolean
    }

export type McpTool = {
  server: string
  name: string
  description?: string
  inputSchema?: JsonSchema
}

export type McpResource = {
  uri: string
  name?: string
  description?: string
}

export type McpClient = {
  listTools(): Awaitable<readonly McpTool[]>
  callTool(args: {
    server: string
    name: string
    input: unknown
  }): Awaitable<unknown>
  listResources?(): Awaitable<readonly McpResource[]>
  readResource?(uri: string): Awaitable<unknown>
}

export async function createMcpTools<CONTEXT extends JsonLike>(
  client: McpClient
): Promise<ToolSet<CONTEXT>> {
  const tools = await client.listTools()
  const entries: Array<[string, Tool<CONTEXT>]> = tools.map(tool => [
    mcpToolName(tool.server, tool.name),
    toolFromMcp<CONTEXT>(client, tool)
  ])

  if (client.listResources && client.readResource) {
    entries.push(['mcp_read_resource', readResourceTool<CONTEXT>(client)])
  }

  return Object.fromEntries(entries) as ToolSet<CONTEXT>
}

export async function withMcpTools<CONTEXT extends JsonLike>(
  client: McpClient
): Promise<AgentPlugin<CONTEXT>> {
  const tools = await createMcpTools<CONTEXT>(client)
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), ...tools }
  })
}

export function mcpToolName(server: string, tool: string) {
  return `mcp__${sanitize(server)}__${sanitize(tool)}`
}

function toolFromMcp<CONTEXT extends JsonLike>(
  client: McpClient,
  tool: McpTool
): Tool<CONTEXT> {
  return {
    description:
      tool.description ?? `Call MCP tool ${tool.server}/${tool.name}.`,
    inputSchema: tool.inputSchema ?? objectSchema({}),
    execute: (input: unknown) =>
      client.callTool({ server: tool.server, name: tool.name, input })
  } as unknown as Tool<CONTEXT>
}

function readResourceTool<CONTEXT extends JsonLike>(
  client: McpClient
): Tool<CONTEXT> {
  return {
    description: 'Read MCP resource by URI.',
    inputSchema: objectSchema({ uri: { type: 'string' } }, ['uri']),
    execute: (input: unknown) => {
      const record = assertRecord(input, 'mcp_read_resource')
      return client.readResource!(stringField(record, 'uri'))
    }
  } as unknown as Tool<CONTEXT>
}

function sanitize(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[] = []
): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

function assertRecord(input: unknown, name: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${name} input must be an object.`)
  }
  return input as Record<string, unknown>
}

function stringField(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}
