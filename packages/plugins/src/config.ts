// @ts-nocheck
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
import { withPermissionRules, type PermissionRule } from './permissions.js'
import { withProjectContext } from './project-context.js'
import { withCodingTools } from './coding-tools.js'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type CodingTool = 'read' | 'write' | 'list' | 'grep' | 'shell' | 'patch'

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
  return JSON.parse(raw) as PluginConfig
}

export function pluginsFromConfig<CONTEXT extends JsonLike>(params: {
  config: PluginConfig
  askPermission: Parameters<typeof withPermissionRules<CONTEXT>>[0]['request']
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
