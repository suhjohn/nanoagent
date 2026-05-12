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
export function withToolPermission(check) {
    return appendCallToolMiddleware(async ({ input, next }) => {
        const decision = await check({
            toolName: input.toolCall.toolName,
            input: input.toolCall.input,
            context: input.context
        });
        if (decision.allow)
            return next(input);
        return {
            toolCallId: input.toolCall.toolCallId,
            toolName: input.toolCall.toolName,
            input: input.toolCall.input,
            output: decision.output ?? { denied: true, reason: decision.reason }
        };
    });
}
export function withToolResultMapper(map) {
    return appendCallToolMiddleware(async ({ input, next }) => map({ response: await next(input), context: input.context }));
}
export function withToolErrorBoundary(map) {
    return appendCallToolMiddleware(async ({ input, next }) => {
        try {
            return await next(input);
        }
        catch (error) {
            return {
                toolCallId: input.toolCall.toolCallId,
                toolName: input.toolCall.toolName,
                input: input.toolCall.input,
                error: map
                    ? await map({
                        error,
                        toolName: input.toolCall.toolName,
                        input: input.toolCall.input,
                        context: input.context
                    })
                    : error
            };
        }
    });
}
export function withToolConcurrency(params) {
    const queues = new Map();
    return appendCallToolMiddleware(async ({ input, next }) => {
        const key = params?.key?.({
            toolName: input.toolCall.toolName,
            input: input.toolCall.input,
            context: input.context
        }) ?? input.toolCall.toolName;
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
    });
}
export function withVisibleTools(select) {
    return options => {
        const tools = options.tools ?? {};
        const selected = new Set(select({ tools }));
        return {
            ...options,
            tools: Object.fromEntries(Object.entries(tools).filter(([name]) => selected.has(name)))
        };
    };
}
