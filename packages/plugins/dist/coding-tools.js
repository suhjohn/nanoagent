import { withFilesystemTools } from './filesystem.js'
import { withShellTool } from './shell.js'
import { withApplyPatchTool } from './patch.js'
const DEFAULT_TOOLS = ['read', 'write', 'grep', 'shell']
const FILESYSTEM_TOOLS = ['read', 'write', 'list', 'grep']
export function withCodingTools(params) {
  const enabled = new Set(params.enabled ?? DEFAULT_TOOLS)
  const plugins = []
  if (FILESYSTEM_TOOLS.some(tool => enabled.has(tool))) {
    plugins.push(
      withFilesystemTools({
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
    plugins.push(withShellTool({ cwd: params.cwd, toolName: 'bash' }))
  }
  if (enabled.has('patch')) {
    plugins.push(withApplyPatchTool({ root: params.cwd }))
  }
  return options => plugins.reduce((next, plugin) => plugin(next), options)
}
function nameOrDisabled(enabled, flag, name) {
  return enabled.has(flag) ? name : false
}
