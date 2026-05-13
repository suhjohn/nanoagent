// Origin:
// - OpenCode: packages/opencode/src/permission/index.ts, config/permission.ts
// - Codex: codex-rs/core/src/tools/sandboxing.rs, session granted permissions
// Behavior: infer tool permission requests, evaluate ordered allow/deny rules, and optionally remember user grants.
import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolSet<CONTEXT extends JsonLike> = NonNullable<
  RunAgentOptions<CONTEXT>['tools']
>

type Tool<CONTEXT extends JsonLike> = ToolSet<CONTEXT>[string]

export type PermissionAction = 'allow' | 'deny'

export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

export type PermissionRequest = {
  permission: string
  patterns: string[]
  reason?: string
}

export type PermissionInferParams<CONTEXT> = {
  toolName: string
  input: unknown
  context: CONTEXT
}

export type PermissionRequestDecision = {
  action: PermissionAction
  remember?: boolean
  reason?: string
}

export type WithPermissionRulesParams<CONTEXT extends JsonLike> = {
  rules: PermissionRule[]
  request: (
    params: PermissionRequest & { context: CONTEXT }
  ) => PermissionRequestDecision | Promise<PermissionRequestDecision>
  infer?: (params: PermissionInferParams<CONTEXT>) => PermissionRequest
}

export type GrantPermissionParams<CONTEXT> = PermissionRequest & {
  context?: CONTEXT
}

export type WithRequestPermissionsToolParams<CONTEXT extends JsonLike> = {
  grant: (params: GrantPermissionParams<CONTEXT>) => unknown
  toolName?: string
}

export function evaluatePermissionRules(params: {
  rules: PermissionRule[]
  permission: string
  patterns: string[]
}): PermissionAction | undefined {
  let decision: PermissionAction | undefined
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

export function withPermissionRules<CONTEXT extends JsonLike>(
  params: WithPermissionRulesParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  const remembered = new Set<string>()

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

export function withRequestPermissionsTool<CONTEXT extends JsonLike>(
  params: WithRequestPermissionsToolParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  const toolName = params.toolName ?? 'request_permissions'

  const tool: Tool<CONTEXT> = {
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
    execute: (input: unknown, options: { experimental_context?: CONTEXT }) => {
      const record = assertRecord(input, toolName)
      return params.grant({
        permission: stringField(record, 'permission'),
        patterns: stringArrayField(record, 'patterns'),
        reason: stringField(record, 'reason', false),
        context: options.experimental_context
      })
    }
  } as unknown as Tool<CONTEXT>

  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [toolName]: tool }
  })
}

function inferRequest<CONTEXT extends JsonLike>(
  params: WithPermissionRulesParams<CONTEXT>,
  input: {
    toolCall: { toolName: string; input: unknown }
    context: CONTEXT
  }
): PermissionRequest {
  if (params.infer) {
    return params.infer({
      toolName: input.toolCall.toolName,
      input: input.toolCall.input,
      context: input.context
    })
  }
  return defaultPermissionRequest(input.toolCall.toolName, input.toolCall.input)
}

function defaultPermissionRequest(
  permission: string,
  input: unknown
): PermissionRequest {
  return { permission, patterns: [defaultPattern(permission, input)] }
}

function defaultPattern(permission: string, input: unknown): string {
  const record =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (typeof record.path === 'string') return record.path
  if (typeof record.filePath === 'string') return record.filePath
  if (typeof record.cmd === 'string')
    return record.cmd.split(/\s+/)[0] || permission
  return permission
}

function deniedResponse(
  toolCall: { toolCallId: string; toolName: string; input: unknown },
  reason: string
) {
  return {
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: toolCall.input,
    output: { denied: true, reason }
  }
}

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === '*') return true
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
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

function stringArrayField(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value
  }
  throw new Error(`${key} must be a string array.`)
}
