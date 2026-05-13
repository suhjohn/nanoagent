const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const MIN_WAIT_TIMEOUT_MS = 10_000
const MAX_WAIT_TIMEOUT_MS = 3_600_000
export function withSubagentTools(host) {
  const tools = {
    spawn_agent: {
      description:
        'Spawn a subagent for bounded work. Use message or items, and omit model overrides unless explicitly needed.',
      inputSchema: objectSchema({
        message: { type: 'string' },
        items: { type: 'array', items: { type: 'object' } },
        agent_type: { type: 'string' },
        fork_context: { type: 'boolean' },
        model: { type: 'string' },
        reasoning_effort: { type: 'string' }
      }),
      execute: (input, options) => {
        const record = assertRecord(input, 'spawn_agent')
        const message = stringField(record, 'message', false)
        const items = inputItemsField(record, 'items')
        if ((message === undefined) === (items === undefined)) {
          throw new Error(
            'spawn_agent requires exactly one of message or items.'
          )
        }
        if (message !== undefined && message.trim() === '') {
          throw new Error('message must not be empty.')
        }
        if (
          record.fork_context === true &&
          (record.agent_type !== undefined ||
            record.model !== undefined ||
            record.reasoning_effort !== undefined)
        ) {
          throw new Error(
            'Full-history forked agents inherit agent type, model, and reasoning effort.'
          )
        }
        return host.spawn({
          message,
          items,
          agentType: stringField(record, 'agent_type', false),
          forkContext: booleanField(record, 'fork_context', false),
          model: stringField(record, 'model', false),
          reasoningEffort: stringField(record, 'reasoning_effort', false),
          context: options.experimental_context
        })
      }
    },
    send_input: {
      description:
        'Send a message to an existing agent. Use interrupt=true to redirect work immediately.',
      inputSchema: objectSchema(
        {
          target: { type: 'string' },
          message: { type: 'string' },
          items: { type: 'array', items: { type: 'object' } },
          interrupt: { type: 'boolean' }
        },
        ['target']
      ),
      execute: (input, options) => {
        const record = assertRecord(input, 'send_input')
        const message = stringField(record, 'message', false)
        const items = inputItemsField(record, 'items')
        if ((message === undefined) === (items === undefined)) {
          throw new Error(
            'send_input requires exactly one of message or items.'
          )
        }
        if (message !== undefined && message.trim() === '') {
          throw new Error('message must not be empty.')
        }
        return host.send({
          target: stringField(record, 'target'),
          message,
          items,
          interrupt: booleanField(record, 'interrupt', false) ?? false,
          context: options.experimental_context
        })
      }
    },
    wait_agent: {
      description:
        'Wait for agents to reach a final status. Completed statuses may include final messages.',
      inputSchema: objectSchema(
        {
          targets: { type: 'array', items: { type: 'string' }, minItems: 1 },
          timeout_ms: {
            type: 'integer',
            minimum: MIN_WAIT_TIMEOUT_MS,
            maximum: MAX_WAIT_TIMEOUT_MS
          }
        },
        ['targets']
      ),
      execute: (input, options) => {
        const record = assertRecord(input, 'wait_agent')
        return host.wait({
          targets: stringArrayField(record, 'targets'),
          timeoutMs: numberField(
            record,
            'timeout_ms',
            DEFAULT_WAIT_TIMEOUT_MS,
            MIN_WAIT_TIMEOUT_MS,
            MAX_WAIT_TIMEOUT_MS
          ),
          context: options.experimental_context
        })
      }
    },
    resume_agent: {
      description:
        'Resume a previously closed agent by id so it can receive send_input and wait_agent calls.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input, options) => {
        const record = assertRecord(input, 'resume_agent')
        return host.resume({
          id: stringField(record, 'id'),
          context: options.experimental_context
        })
      }
    },
    close_agent: {
      description:
        'Close an agent and open descendants when they are no longer needed.',
      inputSchema: objectSchema({ target: { type: 'string' } }, ['target']),
      execute: (input, options) => {
        const record = assertRecord(input, 'close_agent')
        return host.close({
          target: stringField(record, 'target'),
          context: options.experimental_context
        })
      }
    }
  }
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), ...tools }
  })
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
function stringField(input, key, required = true) {
  const value = input[key]
  if (typeof value === 'string') return value
  if (!required && value === undefined) return undefined
  throw new Error(`${key} must be a string.`)
}
function booleanField(input, key, required = true) {
  const value = input[key]
  if (typeof value === 'boolean') return value
  if (!required && value === undefined) return undefined
  throw new Error(`${key} must be a boolean.`)
}
function numberField(input, key, fallback, minimum, maximum) {
  const value = input[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number.`)
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${key} must be between ${minimum} and ${maximum}.`)
  }
  return value
}
function stringArrayField(input, key) {
  const value = input[key]
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value
  }
  throw new Error(`${key} must be a string array.`)
}
function inputItemsField(input, key) {
  const value = input[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${key} must be a non-empty array.`)
  }
  return value.map((item, index) => parseInputItem(item, `${key}[${index}]`))
}
function parseInputItem(raw, name) {
  const item = assertRecord(raw, name)
  const type = stringField(item, 'type')
  if (type === 'text') return { type, text: stringField(item, 'text') }
  if (type === 'image')
    return { type, image_url: stringField(item, 'image_url') }
  if (type === 'local_image') return { type, path: stringField(item, 'path') }
  if (type === 'skill' || type === 'mention') {
    return {
      type,
      name: stringField(item, 'name', false),
      path: stringField(item, 'path', false)
    }
  }
  throw new Error(`${name}.type is not a supported input item type.`)
}
