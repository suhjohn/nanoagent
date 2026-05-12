// @ts-nocheck
// Origin:
// - Codex: codex-rs/config/src/loader/mod.rs, core/src/config/mod.rs, config/permissions.rs
// - OpenCode: packages/opencode/src/config/config.ts, config/plugin.ts, config/agent.ts
// Behavior: load plugin config and convert config surfaces into concrete plugin composition.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withPermissionRules } from './permissions.js';
import { withProjectContext } from './project-context.js';
import { withCodingTools } from './coding-tools.js';
export async function loadPluginConfig(filePath) {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
}
export function pluginsFromConfig(params) {
    const cwd = path.resolve(params.config.cwd ?? process.cwd());
    const plugins = [
        withCodingTools({ cwd, enabled: params.config.tools }),
        params.config.projectContext === false
            ? (options) => options
            : withProjectContext({ cwd }),
        withPermissionRules({
            rules: params.config.permissions ?? [],
            request: params.askPermission
        })
    ];
    return options => plugins.reduce((next, plugin) => plugin(next), options);
}
