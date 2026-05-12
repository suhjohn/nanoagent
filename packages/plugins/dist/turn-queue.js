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
export function withTurnQueue(params) {
    const take = params.mode === 'one-at-a-time' ? 1 : Number.POSITIVE_INFINITY;
    return options => withTurnCompleted(async (args) => {
        const context = args.context;
        const followUp = (await params.store.followUp(context)).slice(0, take);
        if (followUp.length)
            await params.store.shiftFollowUp(context, followUp.length);
    })(withTurnPrepared(async ({ args, value }) => {
        const context = args.context;
        const steering = (await params.store.steering(context)).slice(0, take);
        if (!steering.length)
            return { value };
        await params.store.shiftSteering(context, steering.length);
        return {
            value: appendMessages(value, steering.map(text => message('user', text)))
        };
    })(options));
}
