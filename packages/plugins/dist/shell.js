// Origin:
// - Codex: codex-rs/core/src/tools/handlers/shell.rs, tools/runtimes/shell.rs, handlers/unified_exec/exec_command.rs
// - OpenCode: packages/opencode/src/tool/bash.ts
// - Pi: packages/coding-agent/src/core/tools/bash.ts
// Behavior: local command execution with cwd, argv, timeout, abort, and structured stdout/stderr result.
// @ts-nocheck
import { spawn } from 'node:child_process';
const composePlugins = (...plugins) => options => plugins.reduce((nextOptions, plugin) => plugin(nextOptions), options);
const defineTool = spec => spec;
const withTool = (name, tool) => options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [name]: tool }
});
const withTools = tools => options => ({
    ...options,
    tools: { ...(options.tools ?? {}), ...tools }
});
const appendCallModelMiddleware = middleware => options => ({
    ...options,
    middleware: {
        ...(options.middleware ?? {}),
        callModel: [...(options.middleware?.callModel ?? []), middleware]
    }
});
const appendCallToolMiddleware = middleware => options => ({
    ...options,
    middleware: {
        ...(options.middleware ?? {}),
        callTool: [...(options.middleware?.callTool ?? []), middleware]
    }
});
const withTurnPrepared = transform => options => ({
    ...options,
    hooks: {
        ...options.hooks,
        onTurnPrepared: async (args) => {
            const previous = await options.hooks.onTurnPrepared(args);
            if (previous?.control)
                return previous;
            const value = previous?.value;
            if (!value)
                return previous;
            const next = await transform({ args, value });
            return {
                context: next?.context ?? previous?.context,
                value: next?.value ?? value,
                control: next?.control
            };
        }
    }
});
const withTurnCompleted = effect => options => ({
    ...options,
    hooks: {
        ...options.hooks,
        onTurnCompleted: async (args) => {
            const previous = await options.hooks.onTurnCompleted?.(args);
            if (previous?.control)
                return previous;
            const next = await effect(args);
            return {
                context: next?.context ?? previous?.context,
                control: previous?.control
            };
        }
    }
});
const withSaveState = effect => options => ({
    ...options,
    saveState: async (args) => {
        await options.saveState?.(args);
        await effect(args);
    }
});
const objectSchema = (properties, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false
});
const assertRecord = (input, name) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error(`${name} input must be an object.`);
    return input;
};
const stringField = (input, key, required = true) => {
    const value = input[key];
    if (typeof value === 'string')
        return value;
    if (!required && value === undefined)
        return undefined;
    throw new Error(`${key} must be a string.`);
};
const booleanField = (input, key, fallback) => {
    const value = input[key];
    if (value === undefined)
        return fallback;
    if (typeof value === 'boolean')
        return value;
    throw new Error(`${key} must be a boolean.`);
};
const numberField = (input, key, fallback) => {
    const value = input[key];
    if (value === undefined)
        return fallback;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    throw new Error(`${key} must be a number.`);
};
const stringArrayField = (input, key, fallback = []) => {
    const value = input[key];
    if (value === undefined)
        return fallback;
    if (Array.isArray(value) && value.every(item => typeof item === 'string'))
        return value;
    throw new Error(`${key} must be a string array.`);
};
const message = (role, content) => ({ role, content });
const prependMessages = (value, messages) => ({
    ...value,
    messages: [...messages, ...(value.messages ?? [])]
});
const appendMessages = (value, messages) => ({
    ...value,
    messages: [...(value.messages ?? []), ...messages]
});
export function withShellTool(params = {}) {
    const toolName = params.toolName ?? 'shell';
    return withTool(toolName, defineTool({
        description: 'Run local command. Prefer focused commands with explicit cwd and finite timeout.',
        inputSchema: objectSchema({
            cmd: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            cwd: { type: 'string' },
            timeoutMs: { type: 'integer', minimum: 1 }
        }, ['cmd']),
        execute: async (input, options) => {
            const record = assertRecord(input, 'shell');
            const timeoutMs = numberField(record, 'timeoutMs', params.timeoutMs ?? 30_000);
            const args = {
                cmd: stringField(record, 'cmd'),
                args: stringArrayField(record, 'args'),
                cwd: stringField(record, 'cwd', false) ?? params.cwd,
                timeoutMs,
                signal: options.abortSignal,
                context: options.experimental_context
            };
            return params.run ? params.run(args) : runShell(args);
        }
    }));
}
function runShell(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(args.cmd, args.args, {
            cwd: args.cwd,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const stdout = [];
        const stderr = [];
        const timeout = setTimeout(() => child.kill('SIGTERM'), args.timeoutMs);
        const abort = () => child.kill('SIGTERM');
        args.signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
        child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
        child.on('error', error => {
            clearTimeout(timeout);
            args.signal?.removeEventListener('abort', abort);
            reject(error);
        });
        child.on('close', (exitCode, signal) => {
            clearTimeout(timeout);
            args.signal?.removeEventListener('abort', abort);
            resolve({
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
                exitCode,
                signal
            });
        });
    });
}
