// @ts-nocheck
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
export function withSubagentTools(host) {
    const tools = {
        spawn_agent: defineTool({
            description: 'Start child agent for bounded parallel work. Use for independent subtasks that can proceed without blocking current work.',
            inputSchema: objectSchema({
                prompt: { type: 'string' },
                agentType: { type: 'string' }
            }, ['prompt']),
            execute: (input, options) => {
                const record = assertRecord(input, 'spawn_agent');
                return host.spawn({
                    prompt: stringField(record, 'prompt'),
                    agentType: stringField(record, 'agentType', false),
                    context: options.experimental_context
                });
            }
        }),
        send_input: defineTool({
            description: 'Send message to existing child agent.',
            inputSchema: objectSchema({
                id: { type: 'string' },
                message: { type: 'string' },
                interrupt: { type: 'boolean' }
            }, ['id', 'message']),
            execute: (input, options) => {
                const record = assertRecord(input, 'send_input');
                return host.send({
                    id: stringField(record, 'id'),
                    message: stringField(record, 'message'),
                    interrupt: record.interrupt === true,
                    context: options.experimental_context
                });
            }
        }),
        wait_agent: defineTool({
            description: 'Wait for one or more child agents to complete or time out.',
            inputSchema: objectSchema({
                ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
                timeoutMs: { type: 'integer', minimum: 1 }
            }, ['ids']),
            execute: (input, options) => {
                const record = assertRecord(input, 'wait_agent');
                if (!Array.isArray(record.ids) ||
                    !record.ids.every(id => typeof id === 'string')) {
                    throw new Error('ids must be a string array.');
                }
                return host.wait({
                    ids: record.ids,
                    timeoutMs: numberField(record, 'timeoutMs', 30_000),
                    context: options.experimental_context
                });
            }
        }),
        close_agent: defineTool({
            description: 'Close child agent and release host resources.',
            inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
            execute: (input, options) => {
                const record = assertRecord(input, 'close_agent');
                return host.close({
                    id: stringField(record, 'id'),
                    context: options.experimental_context
                });
            }
        })
    };
    return withTools(tools);
}
