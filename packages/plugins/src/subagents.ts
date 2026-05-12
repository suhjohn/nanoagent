import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolSet<CONTEXT extends JsonLike> = NonNullable<
  RunAgentOptions<CONTEXT>['tools']
>

type Tool<CONTEXT extends JsonLike> = ToolSet<CONTEXT>[string]

type ToolExecuteOptions<CONTEXT> = {
  toolCallId: string
  messages: unknown[]
  abortSignal?: AbortSignal
  experimental_context?: CONTEXT
}

export type SubagentHost<CONTEXT extends JsonLike> = {
  spawn: (params: {
    prompt: string
    agentType?: string
    context?: CONTEXT
  }) => unknown
  send: (params: {
    id: string
    message: string
    interrupt: boolean
    context?: CONTEXT
  }) => unknown
  wait: (params: {
    ids: string[]
    timeoutMs: number
    context?: CONTEXT
  }) => unknown
  close: (params: { id: string; context?: CONTEXT }) => unknown
}

export function withSubagentTools<CONTEXT extends JsonLike>(
  host: SubagentHost<CONTEXT>
): AgentPlugin<CONTEXT> {
  const tools: ToolSet<CONTEXT> = {
    spawn_agent: {
      description:
        'Start child agent for bounded parallel work. Use for independent subtasks that can proceed without blocking current work.',
      inputSchema: objectSchema(
        {
          prompt: { type: 'string' },
          agentType: { type: 'string' }
        },
        ['prompt']
      ),
      execute: (input: unknown, options: ToolExecuteOptions<CONTEXT>) => {
        const record = assertRecord(input, 'spawn_agent')
        return host.spawn({
          prompt: stringField(record, 'prompt'),
          agentType: stringField(record, 'agentType', false),
          context: options.experimental_context
        })
      }
    } as unknown as Tool<CONTEXT>,

    send_input: {
      description: 'Send message to existing child agent.',
      inputSchema: objectSchema(
        {
          id: { type: 'string' },
          message: { type: 'string' },
          interrupt: { type: 'boolean' }
        },
        ['id', 'message']
      ),
      execute: (input: unknown, options: ToolExecuteOptions<CONTEXT>) => {
        const record = assertRecord(input, 'send_input')
        return host.send({
          id: stringField(record, 'id'),
          message: stringField(record, 'message'),
          interrupt: record.interrupt === true,
          context: options.experimental_context
        })
      }
    } as unknown as Tool<CONTEXT>,

    wait_agent: {
      description: 'Wait for one or more child agents to complete or time out.',
      inputSchema: objectSchema(
        {
          ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
          timeoutMs: { type: 'integer', minimum: 1 }
        },
        ['ids']
      ),
      execute: (input: unknown, options: ToolExecuteOptions<CONTEXT>) => {
        const record = assertRecord(input, 'wait_agent')
        return host.wait({
          ids: stringArrayField(record, 'ids'),
          timeoutMs: numberField(record, 'timeoutMs', 30_000),
          context: options.experimental_context
        })
      }
    } as unknown as Tool<CONTEXT>,

    close_agent: {
      description: 'Close child agent and release host resources.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input: unknown, options: ToolExecuteOptions<CONTEXT>) => {
        const record = assertRecord(input, 'close_agent')
        return host.close({
          id: stringField(record, 'id'),
          context: options.experimental_context
        })
      }
    } as unknown as Tool<CONTEXT>
  }

  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), ...tools }
  })
}

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = []
) {
  return { type: 'object', properties, required, additionalProperties: false }
}

function assertRecord(input: unknown, name: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${name} input must be an object.`)
  }
  return input as Record<string, unknown>
}

function stringField(
  input: Record<string, unknown>,
  key: string,
  required?: true
): string
function stringField(
  input: Record<string, unknown>,
  key: string,
  required: false
): string | undefined
function stringField(
  input: Record<string, unknown>,
  key: string,
  required = true
) {
  const value = input[key]
  if (typeof value === 'string') return value
  if (!required && value === undefined) return undefined
  throw new Error(`${key} must be a string.`)
}

function numberField(
  input: Record<string, unknown>,
  key: string,
  fallback: number
) {
  const value = input[key]
  if (value === undefined) return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${key} must be a number.`)
}

function stringArrayField(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value
  }
  throw new Error(`${key} must be a string array.`)
}
