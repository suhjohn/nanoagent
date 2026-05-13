export function withTaskTool(params) {
  const toolName = params.toolName ?? 'task'
  return withTool(toolName, {
    description:
      'Delegate bounded work to named subagent. Returns task_id so later calls can resume same subagent session.',
    inputSchema: objectSchema(
      {
        description: { type: 'string' },
        prompt: { type: 'string' },
        subagent_type: { type: 'string' },
        task_id: { type: 'string' }
      },
      ['description', 'prompt', 'subagent_type']
    ),
    execute: async (input, options) => {
      const record = assertRecord(input, toolName)
      const subagentType = stringField(record, 'subagent_type')
      const agent = await findAgent(params.agents, subagentType)
      const result = await params.run({
        description: stringField(record, 'description'),
        prompt: stringField(record, 'prompt'),
        agent,
        taskId: optionalStringField(record, 'task_id'),
        context: options.experimental_context
      })
      return {
        task_id: result.taskId,
        output: formatTaskOutput(result),
        metadata: result.metadata
      }
    }
  })
}
async function findAgent(load, name) {
  const agent = (await load()).find(candidate => candidate.name === name)
  if (!agent) throw new Error(`Unknown agent type: ${name}`)
  return agent
}
function formatTaskOutput(result) {
  return [
    `task_id: ${result.taskId}`,
    '',
    '<task_result>',
    result.output,
    '</task_result>'
  ].join('\n')
}
function withTool(name, tool) {
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [name]: tool }
  })
}
function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  }
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
function optionalStringField(input, key) {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}
