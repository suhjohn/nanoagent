// Origin:
// - OpenCode: packages/opencode/src/config/config.ts, config/permission.ts
// - Pi: packages/coding-agent/src/core/settings-manager.ts
// Behavior: load plugin config and compose configured context, tools, and permission rules.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withPermissionRules } from './permissions.js';
import { withProjectContext } from './project-context.js';
import { withCodingTools } from './coding-tools.js';
export async function loadPluginConfig(filePath) {
    const raw = await readFile(filePath, 'utf8');
    return parsePluginConfig(JSON.parse(raw));
}
export function pluginsFromConfig(params) {
    const cwd = path.resolve(params.config.cwd ?? process.cwd());
    const plugins = [
        withCodingTools({ cwd, enabled: params.config.tools })
    ];
    if (params.config.projectContext !== false) {
        plugins.push(withProjectContext({ cwd }));
    }
    plugins.push(withPermissionRules({
        rules: params.config.permissions ?? [],
        request: params.askPermission
    }));
    return options => plugins.reduce((next, plugin) => plugin(next), options);
}
const CODING_TOOLS = new Set([
    'read',
    'write',
    'list',
    'grep',
    'shell',
    'patch'
]);
const PERMISSION_ACTIONS = new Set(['allow', 'deny']);
function parsePluginConfig(input) {
    const record = assertRecord(input, 'plugin config');
    return {
        cwd: stringField(record, 'cwd', false),
        permissions: permissionsField(record.permissions),
        tools: codingToolsField(record.tools),
        projectContext: booleanField(record, 'projectContext', false)
    };
}
function permissionsField(input) {
    if (input === undefined)
        return undefined;
    if (!Array.isArray(input))
        throw new Error('permissions must be an array.');
    return input.map(item => {
        const record = assertRecord(item, 'permission rule');
        const action = stringField(record, 'action');
        if (!PERMISSION_ACTIONS.has(action)) {
            throw new Error('permission action must be allow or deny.');
        }
        return {
            permission: stringField(record, 'permission'),
            pattern: stringField(record, 'pattern'),
            action: action
        };
    });
}
function codingToolsField(input) {
    if (input === undefined)
        return undefined;
    if (!Array.isArray(input))
        throw new Error('tools must be an array.');
    return input.map(item => {
        if (typeof item !== 'string' || !CODING_TOOLS.has(item)) {
            throw new Error('tools contains an unknown coding tool.');
        }
        return item;
    });
}
function assertRecord(input, name) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error(`${name} must be an object.`);
    }
    return input;
}
function stringField(input, key, required = true) {
    const value = input[key];
    if (typeof value === 'string')
        return value;
    if (!required && value === undefined)
        return undefined;
    throw new Error(`${key} must be a string.`);
}
function booleanField(input, key, required) {
    const value = input[key];
    if (typeof value === 'boolean')
        return value;
    if (!required && value === undefined)
        return undefined;
    throw new Error(`${key} must be a boolean.`);
}
