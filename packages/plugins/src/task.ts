import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolSet = NonNullable<RunAgentOptions<JsonLike>['tools']>
type Tool = ToolSet[string]
type ToolExecuteOptions = Parameters<NonNullable<Tool['execute']>>[1]

type SubagentDescriptor = { name: string } & Record<string, unknown>

type TaskRunResult = {
  taskId: string
  output: string
  metadata?: unknown
}

type TaskParams<CONTEXT extends JsonLike> = {
  toolName?: string
  agents: () => SubagentDescriptor[] | Promise<SubagentDescriptor[]>
  run: (args: {
    description: string
    prompt: string
    agent: SubagentDescriptor
    taskId?: string
    context: CONTEXT | undefined
  }) => Promise<TaskRunResult>
}

export function withTaskTool<CONTEXT extends JsonLike>(
  params: TaskParams<CONTEXT>
): AgentPlugin<CONTEXT> {
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
    execute: async (input: unknown, options: ToolExecuteOptions) => {
      const record = assertRecord(input, toolName)
      const subagentType = stringField(record, 'subagent_type')
      const agent = await findAgent(params.agents, subagentType)

      const result = await params.run({
        description: stringField(record, 'description'),
        prompt: stringField(record, 'prompt'),
        agent,
        taskId: optionalStringField(record, 'task_id'),
        context: options.experimental_context as CONTEXT | undefined
      })

      return {
        task_id: result.taskId,
        output: formatTaskOutput(result),
        metadata: result.metadata
      }
    }
  })
}

async function findAgent(
  load: () => SubagentDescriptor[] | Promise<SubagentDescriptor[]>,
  name: string
): Promise<SubagentDescriptor> {
  const agent = (await load()).find(candidate => candidate.name === name)
  if (!agent) throw new Error(`Unknown agent type: ${name}`)
  return agent
}

function formatTaskOutput(result: TaskRunResult): string {
  return [
    `task_id: ${result.taskId}`,
    '',
    '<task_result>',
    result.output,
    '</task_result>'
  ].join('\n')
}

function withTool<CONTEXT extends JsonLike>(
  name: string,
  tool: unknown
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [name]: tool as Tool }
  })
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = []
) {
  return {
    type: 'object' as const,
    properties,
    required,
    additionalProperties: false
  }
}

function assertRecord(
  input: unknown,
  name: string
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${name} input must be an object.`)
  }
  return input as Record<string, unknown>
}

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}

function optionalStringField(
  input: Record<string, unknown>,
  key: string
): string | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}
