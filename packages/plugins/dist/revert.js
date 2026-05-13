export function withRevertTools(params) {
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
      execute: (input, options) => {
        const record = assertRecord(input, 'revert_session')
        return params.store.revert({
          sessionId: stringField(record, 'sessionId'),
          messageId: stringField(record, 'messageId'),
          partId: optionalStringField(record, 'partId'),
          context: options.experimental_context
        })
      }
    },
    unrevert_session: {
      description:
        'Restore pre-revert snapshot and clear pending revert marker.',
      inputSchema: objectSchema({ sessionId: { type: 'string' } }, [
        'sessionId'
      ]),
      execute: (input, options) => {
        const record = assertRecord(input, 'unrevert_session')
        return params.store.unrevert({
          sessionId: stringField(record, 'sessionId'),
          context: options.experimental_context
        })
      }
    }
  })
}
function withTools(tools) {
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), ...tools }
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
