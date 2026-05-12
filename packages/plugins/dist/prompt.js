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
export function withSystemPrompt(content) {
    return withTurnPrepared(async ({ args, value }) => ({
        value: prependMessages(value, [
            message('system', typeof content === 'string' ? content : await content(args.context))
        ])
    }));
}
export function withPromptMessages(load) {
    return withTurnPrepared(async ({ args, value }) => ({
        value: appendMessages(value, await load({ context: args.context, value }))
    }));
}
export function withMemory(load) {
    return withTurnPrepared(async ({ args, value }) => {
        const memories = await load({ context: args.context });
        if (!memories.length)
            return { value };
        return {
            value: prependMessages(value, [
                message('system', `Memory:\n${memories.map(item => `- ${item}`).join('\n')}`)
            ])
        };
    });
}
export function withSkills(load) {
    return withTurnPrepared(async ({ args, value }) => {
        const skills = await load({ context: args.context });
        if (!skills.length)
            return { value };
        return {
            value: prependMessages(value, [
                message('system', `Available skills:\n${skills
                    .map(skill => `## ${skill.name}\n${skill.body}`)
                    .join('\n\n')}`)
            ])
        };
    });
}
export function withSlashCommands(expand) {
    return withTurnPrepared(async ({ args, value }) => ({
        value: appendMessages(value, await expand({ context: args.context, value }))
    }));
}
export function withCompaction(params) {
    return withTurnPrepared(async ({ args, value }) => {
        const context = args.context;
        if (!(await params.shouldCompact({ context, value }))) {
            return { value };
        }
        return {
            value: {
                ...value,
                messages: await params.compact({ context, value })
            }
        };
    });
}
