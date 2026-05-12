import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolSet = NonNullable<RunAgentOptions<JsonLike>['tools']>
type Tool = ToolSet[string]
type ToolExecuteOptions = Parameters<NonNullable<Tool['execute']>>[1]

type RevertStore<CONTEXT extends JsonLike> = {
  revert: (args: {
    sessionId: string
    messageId: string
    partId?: string
    context: CONTEXT | undefined
  }) => unknown | Promise<unknown>
  unrevert: (args: {
    sessionId: string
    context: CONTEXT | undefined
  }) => unknown | Promise<unknown>
}

type RevertParams<CONTEXT extends JsonLike> = {
  store: RevertStore<CONTEXT>
}

export function withRevertTools<CONTEXT extends JsonLike>(
  params: RevertParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  return withTools({
    revert_session: {
      description:
        'Restore snapshot and remove message/part range after target session message. Use only when user requests revert.',
      inputSchema: objectSchema(
        {
          sessionId: { type: 'string' },
          messageId: { type: 'string' },
          partId: { type: 'string' }
        },
        ['sessionId', 'messageId']
      ),
      execute: (input: unknown, options: ToolExecuteOptions) => {
        const record = assertRecord(input, 'revert_session')
        return params.store.revert({
          sessionId: stringField(record, 'sessionId'),
          messageId: stringField(record, 'messageId'),
          partId: optionalStringField(record, 'partId'),
          context: options.experimental_context as CONTEXT | undefined
        })
      }
    },
    unrevert_session: {
      description:
        'Restore pre-revert snapshot and clear pending revert marker.',
      inputSchema: objectSchema({ sessionId: { type: 'string' } }, [
        'sessionId'
      ]),
      execute: (input: unknown, options: ToolExecuteOptions) => {
        const record = assertRecord(input, 'unrevert_session')
        return params.store.unrevert({
          sessionId: stringField(record, 'sessionId'),
          context: options.experimental_context as CONTEXT | undefined
        })
      }
    }
  })
}

function withTools<CONTEXT extends JsonLike>(
  tools: Record<string, unknown>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), ...(tools as ToolSet) }
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
