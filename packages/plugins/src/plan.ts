import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolSet<CONTEXT extends JsonLike> = NonNullable<
  RunAgentOptions<CONTEXT>['tools']
>

type Tool<CONTEXT extends JsonLike> = ToolSet<CONTEXT>[string]

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export type PlanItem = {
  step: string
  status: PlanStatus
}

export type PlanInput = {
  explanation?: string
  plan: PlanItem[]
}

export type PlanUpdateParams<CONTEXT> = {
  input: PlanInput
  context?: CONTEXT
}

export type WithPlanToolParams<CONTEXT extends JsonLike> = {
  update: (params: PlanUpdateParams<CONTEXT>) => unknown
  toolName?: string
}

const PLAN_STATUSES: readonly PlanStatus[] = [
  'pending',
  'in_progress',
  'completed'
]

export function withPlanTool<CONTEXT extends JsonLike>(
  params: WithPlanToolParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  const toolName = params.toolName ?? 'plan'

  const tool: Tool<CONTEXT> = {
    description:
      'Publish current task checklist. Keep at most one item in_progress and update status as work completes.',
    inputSchema: objectSchema(
      {
        explanation: { type: 'string' },
        plan: {
          type: 'array',
          minItems: 1,
          items: objectSchema(
            {
              step: { type: 'string' },
              status: { type: 'string', enum: PLAN_STATUSES }
            },
            ['step', 'status']
          )
        }
      },
      ['plan']
    ),
    execute: (
      input: unknown,
      options: {
        toolCallId: string
        messages: unknown[]
        abortSignal?: AbortSignal
        experimental_context?: CONTEXT
      }
    ) =>
      params.update({
        input: parsePlanInput(input),
        context: options.experimental_context
      })
  } as unknown as Tool<CONTEXT>

  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [toolName]: tool }
  })
}

function parsePlanInput(input: unknown): PlanInput {
  const record = assertRecord(input, 'plan')
  const rawPlan = record.plan
  if (!Array.isArray(rawPlan) || rawPlan.length === 0) {
    throw new Error('plan must contain at least one item.')
  }
  const plan = rawPlan.map(parsePlanItem)
  const active = plan.filter(item => item.status === 'in_progress')
  if (active.length > 1) {
    throw new Error('plan can contain at most one in_progress item.')
  }
  return {
    explanation: optionalStringField(record, 'explanation'),
    plan
  }
}

function parsePlanItem(raw: unknown): PlanItem {
  const item = assertRecord(raw, 'plan item')
  const status = stringField(item, 'status')
  if (!isPlanStatus(status)) {
    throw new Error(`Invalid plan status "${status}".`)
  }
  return { step: stringField(item, 'step'), status }
}

function isPlanStatus(value: string): value is PlanStatus {
  return (PLAN_STATUSES as readonly string[]).includes(value)
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
