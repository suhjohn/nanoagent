// Origin:
// - OpenCode: packages/opencode/src/tool/edit.ts file locks
// - Codex: codex-rs/core/src/tools/orchestrator.rs serialized tool execution
// Behavior: serialize mutating file tools by realpath/root key.
import { realpathSync } from 'node:fs';
import path from 'node:path';
const DEFAULT_TOOL_NAMES = [
    'write_file',
    'edit_file',
    'apply_patch',
    'write',
    'edit'
];
const queues = new Map();
export function withFileMutationQueue(params) {
    const names = new Set(params?.toolNames ?? DEFAULT_TOOL_NAMES);
    const customPath = params?.path;
    return options => ({
        ...options,
        middleware: {
            ...options.middleware,
            callTool: [
                ...(options.middleware?.callTool ?? []),
                async ({ input, next }) => {
                    if (!names.has(input.toolCall.toolName))
                        return next(input);
                    const target = customPath?.(input.toolCall.input) ??
                        defaultPath(input.toolCall.input);
                    if (!target)
                        return next(input);
                    return runSerialized(queueKey(target), () => next(input));
                }
            ]
        }
    });
}
async function runSerialized(key, task) {
    const previous = queues.get(key) ?? Promise.resolve();
    let release = () => { };
    const current = previous.then(() => new Promise(resolve => (release = resolve)));
    queues.set(key, current);
    await previous;
    try {
        return await task();
    }
    finally {
        release();
        if (queues.get(key) === current)
            queues.delete(key);
    }
}
function defaultPath(input) {
    if (!input || typeof input !== 'object')
        return undefined;
    const record = input;
    if (typeof record.path === 'string')
        return record.path;
    if (typeof record.filePath === 'string')
        return record.filePath;
    return undefined;
}
function queueKey(filePath) {
    const resolved = path.resolve(filePath);
    try {
        return realpathSync.native(resolved);
    }
    catch {
        return resolved;
    }
}
