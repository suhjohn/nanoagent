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
export function withPlanTool(params) {
    const toolName = params.toolName ?? 'plan';
    return withTool(toolName, defineTool({
        description: 'Publish current task checklist. Keep at most one item in_progress and update status as work completes.',
        inputSchema: objectSchema({
            explanation: { type: 'string' },
            plan: {
                type: 'array',
                minItems: 1,
                items: objectSchema({
                    step: { type: 'string' },
                    status: {
                        type: 'string',
                        enum: ['pending', 'in_progress', 'completed']
                    }
                }, ['step', 'status'])
            }
        }, ['plan']),
        execute: (input, options) => params.update({
            input: parsePlanInput(input),
            context: options.experimental_context
        })
    }));
}
function parsePlanInput(input) {
    const record = assertRecord(input, 'plan');
    const rawPlan = record.plan;
    if (!Array.isArray(rawPlan) || rawPlan.length === 0) {
        throw new Error('plan must contain at least one item.');
    }
    const plan = rawPlan.map(item => {
        const record = assertRecord(item, 'plan item');
        const status = stringField(record, 'status');
        if (!['pending', 'in_progress', 'completed'].includes(status)) {
            throw new Error(`Invalid plan status "${status}".`);
        }
        return {
            step: stringField(record, 'step'),
            status: status
        };
    });
    const active = plan.filter(item => item.status === 'in_progress');
    if (active.length > 1) {
        throw new Error('plan can contain at most one in_progress item.');
    }
    return {
        explanation: stringField(record, 'explanation', false),
        plan
    };
}
