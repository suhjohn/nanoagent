import { withFilesystemTools } from './filesystem.js';
import { withShellTool } from './shell.js';
import { withApplyPatchTool } from './patch.js';
export function withCodingTools(params) {
    const enabled = new Set(params.enabled ?? ['read', 'write', 'grep', 'shell']);
    const plugins = [
        enabled.has('read') ||
            enabled.has('write') ||
            enabled.has('list') ||
            enabled.has('grep')
            ? withFilesystemTools({
                root: params.cwd,
                readToolName: enabled.has('read') ? 'read' : '__disabled_read',
                writeToolName: enabled.has('write') ? 'write' : '__disabled_write',
                editToolName: enabled.has('write') ? 'edit' : '__disabled_edit',
                listToolName: enabled.has('list') ? 'ls' : '__disabled_ls',
                grepToolName: enabled.has('grep') ? 'grep' : '__disabled_grep'
            })
            : (options) => options,
        enabled.has('shell')
            ? withShellTool({ cwd: params.cwd, toolName: 'bash' })
            : (options) => options,
        enabled.has('patch')
            ? withApplyPatchTool({ root: params.cwd })
            : (options) => options
    ];
    return options => plugins.reduce((next, plugin) => plugin(next), options);
}
