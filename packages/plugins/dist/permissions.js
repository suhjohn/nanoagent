export function evaluatePermissionRules(params) {
  let decision
  for (const rule of params.rules) {
    if (rule.permission !== params.permission && rule.permission !== '*') {
      continue
    }
    if (
      !params.patterns.some(pattern => wildcardMatch(rule.pattern, pattern))
    ) {
      continue
    }
    decision = rule.action
  }
  return decision
}
export function withPermissionRules(params) {
  const remembered = new Set()
  return options => ({
    ...options,
    middleware: {
      ...(options.middleware ?? {}),
      callTool: [
        ...(options.middleware?.callTool ?? []),
        async ({ input, next }) => {
          const request = inferRequest(params, input)
          const cacheKey = `${request.permission}:${request.patterns.join('\0')}`
          if (remembered.has(cacheKey)) return next(input)
          const action =
            evaluatePermissionRules({
              rules: params.rules,
              permission: request.permission,
              patterns: request.patterns
            }) ?? 'ask'
          if (action === 'allow') return next(input)
          if (action === 'deny') {
            return deniedResponse(input.toolCall, 'Denied by permission rule.')
          }
          const decision = await params.request({
            ...request,
            context: input.context
          })
          if (decision.action === 'allow') {
            if (decision.remember) remembered.add(cacheKey)
            return next(input)
          }
          return deniedResponse(
            input.toolCall,
            decision.reason ?? 'Denied by user.'
          )
        }
      ]
    }
  })
}
export function withRequestPermissionsTool(params) {
  const toolName = params.toolName ?? 'request_permissions'
  const tool = {
    description:
      'Request additional permission for a blocked operation. Use before retrying denied filesystem, shell, network, or task actions.',
    inputSchema: objectSchema(
      {
        permission: { type: 'string' },
        patterns: { type: 'array', items: { type: 'string' }, minItems: 1 },
        reason: { type: 'string' }
      },
      ['permission', 'patterns']
    ),
    execute: (input, options) => {
      const record = assertRecord(input, toolName)
      return params.grant({
        permission: stringField(record, 'permission'),
        patterns: stringArrayField(record, 'patterns'),
        reason: stringField(record, 'reason', false),
        context: options.experimental_context
      })
    }
  }
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [toolName]: tool }
  })
}
function inferRequest(params, input) {
  if (params.infer) {
    return params.infer({
      toolName: input.toolCall.toolName,
      input: input.toolCall.input,
      context: input.context
    })
  }
  return defaultPermissionRequest(input.toolCall.toolName, input.toolCall.input)
}
function defaultPermissionRequest(permission, input) {
  return { permission, patterns: [defaultPattern(permission, input)] }
}
function defaultPattern(permission, input) {
  const record = input && typeof input === 'object' ? input : {}
  if (typeof record.path === 'string') return record.path
  if (typeof record.filePath === 'string') return record.filePath
  if (typeof record.cmd === 'string')
    return record.cmd.split(/\s+/)[0] || permission
  return permission
}
function deniedResponse(toolCall, reason) {
  return {
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: toolCall.input,
    output: { denied: true, reason }
  }
}
function wildcardMatch(pattern, value) {
  if (pattern === '*') return true
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
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
function stringArrayField(input, key) {
  const value = input[key]
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value
  }
  throw new Error(`${key} must be a string array.`)
}
