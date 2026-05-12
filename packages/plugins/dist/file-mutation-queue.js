// Origin:
// - Pi: packages/coding-agent/src/core/tools/file-mutation-queue.ts
// Behavior: serialize mutations per resolved file while allowing different files to mutate concurrently.
import { realpathSync } from 'node:fs';
import path from 'node:path';
const queues = new Map();
export function withFileMutationQueue(params) {
    const names = new Set(params?.toolNames ?? [
        'write_file',
        'edit_file',
        'apply_patch',
        'write',
        'edit'
    ]);
    return options => ({
        ...options,
        middleware: {
            ...options.middleware,
            callTool: [
                ...(options.middleware?.callTool ?? []),
                async ({ input, next }) => {
                    if (!names.has(input.toolCall.toolName))
                        return next(input);
                    const target = params?.path?.(input.toolCall.input) ??
                        targetPath(input.toolCall.input);
                    if (!target)
                        return next(input);
                    const key = queueKey(target);
                    const previous = queues.get(key) ?? Promise.resolve();
                    let release = () => { };
                    const current = previous.then(() => new Promise(resolve => (release = resolve)));
                    queues.set(key, current);
                    await previous;
                    try {
                        return await next(input);
                    }
                    finally {
                        release();
                        if (queues.get(key) === current)
                            queues.delete(key);
                    }
                }
            ]
        }
    });
}
function targetPath(input) {
    if (!input || typeof input !== 'object')
        return undefined;
    const record = input;
    return typeof record.path === 'string'
        ? record.path
        : typeof record.filePath === 'string'
            ? record.filePath
            : undefined;
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
