// Origin:
// - OpenCode: packages/opencode/src/config/config.ts, config/permission.ts
// - Pi: packages/coding-agent/src/core/settings-manager.ts
// Behavior: load plugin config and compose configured context, tools, and permission rules.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
import {
  withPermissionRules,
  type PermissionRequestDecision,
  type PermissionRule
} from './permissions.js'
import { withProjectContext } from './project-context.js'
import { withCodingTools, type CodingTool } from './coding-tools.js'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

export type PluginConfig = {
  cwd?: string
  permissions?: PermissionRule[]
  tools?: CodingTool[]
  projectContext?: boolean
}

export async function loadPluginConfig(
  filePath: string
): Promise<PluginConfig> {
  const raw = await readFile(filePath, 'utf8')
  return parsePluginConfig(JSON.parse(raw))
}

export function pluginsFromConfig<CONTEXT extends JsonLike>(params: {
  config: PluginConfig
  askPermission: (params: {
    permission: string
    patterns: string[]
    reason?: string
    context: CONTEXT
  }) => PermissionRequestDecision | Promise<PermissionRequestDecision>
}): AgentPlugin<CONTEXT> {
  const cwd = path.resolve(params.config.cwd ?? process.cwd())
  const plugins: AgentPlugin<CONTEXT>[] = [
    withCodingTools<CONTEXT>({ cwd, enabled: params.config.tools })
  ]

  if (params.config.projectContext !== false) {
    plugins.push(withProjectContext<CONTEXT>({ cwd }))
  }

  plugins.push(
    withPermissionRules<CONTEXT>({
      rules: params.config.permissions ?? [],
      request: params.askPermission
    })
  )

  return options => plugins.reduce((next, plugin) => plugin(next), options)
}

const CODING_TOOLS = new Set<CodingTool>([
  'read',
  'write',
  'list',
  'grep',
  'shell',
  'patch'
])

const PERMISSION_ACTIONS = new Set(['allow', 'deny'])

function parsePluginConfig(input: unknown): PluginConfig {
  const record = assertRecord(input, 'plugin config')
  return {
    cwd: stringField(record, 'cwd', false),
    permissions: permissionsField(record.permissions),
    tools: codingToolsField(record.tools),
    projectContext: booleanField(record, 'projectContext', false)
  }
}

function permissionsField(input: unknown): PermissionRule[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) throw new Error('permissions must be an array.')
  return input.map(item => {
    const record = assertRecord(item, 'permission rule')
    const action = stringField(record, 'action')
    if (!PERMISSION_ACTIONS.has(action)) {
      throw new Error('permission action must be allow or deny.')
    }
    return {
      permission: stringField(record, 'permission'),
      pattern: stringField(record, 'pattern'),
      action: action as PermissionRule['action']
    }
  })
}

function codingToolsField(input: unknown): CodingTool[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) throw new Error('tools must be an array.')
  return input.map(item => {
    if (typeof item !== 'string' || !CODING_TOOLS.has(item as CodingTool)) {
      throw new Error('tools contains an unknown coding tool.')
    }
    return item as CodingTool
  })
}

function assertRecord(input: unknown, name: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${name} must be an object.`)
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

function booleanField(
  input: Record<string, unknown>,
  key: string,
  required: false
) {
  const value = input[key]
  if (typeof value === 'boolean') return value
  if (!required && value === undefined) return undefined
  throw new Error(`${key} must be a boolean.`)
}
