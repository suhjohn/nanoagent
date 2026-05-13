const PLAN_STATUSES = ['pending', 'in_progress', 'completed']
export function withPlanTool(params) {
  const toolName = params.toolName ?? 'update_plan'
  const tool = {
    description:
      'Updates the task plan. Provide optional explanation and plan items. At most one step can be in_progress.',
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
    execute: (input, options) =>
      params.update({
        input: parsePlanInput(input),
        context: options.experimental_context
      })
  }
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [toolName]: tool }
  })
}
function parsePlanInput(input) {
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
function parsePlanItem(raw) {
  const item = assertRecord(raw, 'plan item')
  const status = stringField(item, 'status')
  if (!isPlanStatus(status)) {
    throw new Error(`Invalid plan status "${status}".`)
  }
  return { step: stringField(item, 'step'), status }
}
function isPlanStatus(value) {
  return PLAN_STATUSES.includes(value)
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
function optionalStringField(input, key) {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}
