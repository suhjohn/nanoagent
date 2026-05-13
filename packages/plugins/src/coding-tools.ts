// Origin:
// - OpenCode: packages/opencode/src/tool/registry.ts
// - Codex: codex-rs/core/src/tools/spec.rs, spec_plan.rs
// Behavior: compose filesystem, shell, and patch tools into a coding-agent tool bundle.
import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
import { withFilesystemTools } from './filesystem.js'
import { withShellTool } from './shell.js'
import { withApplyPatchTool } from './patch.js'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

export type CodingTool = 'read' | 'write' | 'list' | 'grep' | 'shell' | 'patch'

const DEFAULT_TOOLS: readonly CodingTool[] = ['read', 'write', 'grep', 'shell']
const FILESYSTEM_TOOLS: readonly CodingTool[] = [
  'read',
  'write',
  'list',
  'grep'
]

export function withCodingTools<CONTEXT extends JsonLike>(params: {
  cwd: string
  enabled?: readonly CodingTool[]
}): AgentPlugin<CONTEXT> {
  const enabled = new Set<CodingTool>(params.enabled ?? DEFAULT_TOOLS)
  const plugins: AgentPlugin<CONTEXT>[] = []

  if (FILESYSTEM_TOOLS.some(tool => enabled.has(tool))) {
    plugins.push(
      withFilesystemTools<CONTEXT>({
        root: params.cwd,
        readToolName: nameOrDisabled(enabled, 'read', 'read'),
        writeToolName: nameOrDisabled(enabled, 'write', 'write'),
        editToolName: nameOrDisabled(enabled, 'write', 'edit'),
        listToolName: nameOrDisabled(enabled, 'list', 'ls'),
        grepToolName: nameOrDisabled(enabled, 'grep', 'grep')
      })
    )
  }

  if (enabled.has('shell')) {
    plugins.push(withShellTool<CONTEXT>({ cwd: params.cwd, toolName: 'bash' }))
  }

  if (enabled.has('patch')) {
    plugins.push(withApplyPatchTool<CONTEXT>({ root: params.cwd }))
  }

  return options => plugins.reduce((next, plugin) => plugin(next), options)
}

function nameOrDisabled(
  enabled: Set<CodingTool>,
  flag: CodingTool,
  name: string
): string | false {
  return enabled.has(flag) ? name : false
}
