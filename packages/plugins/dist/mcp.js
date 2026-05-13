export async function createMcpTools(client) {
  const tools = await client.listTools()
  const entries = tools.map(tool => [
    mcpToolName(tool.server, tool.name),
    toolFromMcp(client, tool)
  ])
  if (client.listResources && client.readResource) {
    entries.push(['mcp_read_resource', readResourceTool(client)])
  }
  return Object.fromEntries(entries)
}
export async function withMcpTools(client) {
  const tools = await createMcpTools(client)
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), ...tools }
  })
}
export function mcpToolName(server, tool) {
  return `mcp__${sanitize(server)}__${sanitize(tool)}`
}
function toolFromMcp(client, tool) {
  return {
    description:
      tool.description ?? `Call MCP tool ${tool.server}/${tool.name}.`,
    inputSchema: tool.inputSchema ?? objectSchema({}),
    execute: input =>
      client.callTool({ server: tool.server, name: tool.name, input })
  }
}
function readResourceTool(client) {
  return {
    description: 'Read MCP resource by URI.',
    inputSchema: objectSchema({ uri: { type: 'string' } }, ['uri']),
    execute: input => {
      const record = assertRecord(input, 'mcp_read_resource')
      return client.readResource(stringField(record, 'uri'))
    }
  }
}
function sanitize(value) {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}
function objectSchema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
function assertRecord(input, name) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${name} input must be an object.`)
  }
  return input
}
function stringField(input, key) {
  const value = input[key]
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}
