export async function createMcpTools(client) {
    const entries = await Promise.all((await client.listTools()).map(async (tool) => [
        mcpToolName(tool.server, tool.name),
        {
            description: tool.description ?? `Call MCP tool ${tool.server}/${tool.name}.`,
            inputSchema: tool.inputSchema ?? objectSchema({}),
            execute: (input) => client.callTool({ server: tool.server, name: tool.name, input })
        }
    ]));
    if (client.listResources && client.readResource) {
        entries.push([
            'mcp_read_resource',
            {
                description: 'Read MCP resource by URI.',
                inputSchema: objectSchema({ uri: { type: 'string' } }, ['uri']),
                execute: (input) => client.readResource(stringField(assertRecord(input, 'mcp_read_resource'), 'uri'))
            }
        ]);
    }
    return Object.fromEntries(entries);
}
export async function withMcpTools(client) {
    const tools = await createMcpTools(client);
    return options => ({
        ...options,
        tools: { ...(options.tools ?? {}), ...tools }
    });
}
export function mcpToolName(server, tool) {
    return `mcp__${sanitize(server)}__${sanitize(tool)}`;
}
function sanitize(value) {
    return value.replace(/[^A-Za-z0-9_-]/g, '_');
}
function objectSchema(properties, required = []) {
    return { type: 'object', properties, required, additionalProperties: false };
}
function assertRecord(input, name) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error(`${name} input must be an object.`);
    }
    return input;
}
function stringField(input, key) {
    const value = input[key];
    if (typeof value === 'string')
        return value;
    throw new Error(`${key} must be a string.`);
}
