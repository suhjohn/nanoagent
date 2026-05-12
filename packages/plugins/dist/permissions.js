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
export function evaluatePermissionRules(params) {
    let decision;
    for (const rule of params.rules) {
        if (rule.permission !== params.permission && rule.permission !== '*')
            continue;
        if (!params.patterns.some(pattern => wildcard(rule.pattern, pattern)))
            continue;
        decision = rule.action;
    }
    return decision;
}
export function withPermissionRules(params) {
    const cache = new Set();
    return appendCallToolMiddleware(async ({ input, next }) => {
        const request = params.infer?.({
            toolName: input.toolCall.toolName,
            input: input.toolCall.input,
            context: input.context
        }) ??
            defaultPermissionRequest(input.toolCall.toolName, input.toolCall.input);
        const key = `${request.permission}:${request.patterns.join('\0')}`;
        if (cache.has(key))
            return next(input);
        const action = evaluatePermissionRules({
            rules: params.rules,
            permission: request.permission,
            patterns: request.patterns
        }) ?? 'ask';
        if (action === 'allow')
            return next(input);
        if (action === 'deny')
            return denied(input.toolCall, 'Denied by permission rule.');
        const decision = await params.request({
            ...request,
            context: input.context
        });
        if (decision.action === 'allow') {
            if (decision.remember)
                cache.add(key);
            return next(input);
        }
        return denied(input.toolCall, decision.reason ?? 'Denied by user.');
    });
}
export function withRequestPermissionsTool(params) {
    const toolName = params.toolName ?? 'request_permissions';
    return withTool(toolName, defineTool({
        description: 'Request additional permission for a blocked operation. Use before retrying denied filesystem, shell, network, or task actions.',
        inputSchema: objectSchema({
            permission: { type: 'string' },
            patterns: { type: 'array', items: { type: 'string' }, minItems: 1 },
            reason: { type: 'string' }
        }, ['permission', 'patterns']),
        execute: (input, options) => {
            const record = assertRecord(input, toolName);
            const patterns = record.patterns;
            if (!Array.isArray(patterns) ||
                !patterns.every(item => typeof item === 'string')) {
                throw new Error('patterns must be a string array.');
            }
            return params.grant({
                permission: stringField(record, 'permission'),
                patterns,
                reason: stringField(record, 'reason', false),
                context: options.experimental_context
            });
        }
    }));
}
function defaultPermissionRequest(permission, input) {
    const record = input && typeof input === 'object' ? input : {};
    const pattern = typeof record.path === 'string'
        ? record.path
        : typeof record.filePath === 'string'
            ? record.filePath
            : typeof record.cmd === 'string'
                ? record.cmd.split(/\s+/)[0] || permission
                : permission;
    return { permission, patterns: [pattern] };
}
function denied(toolCall, reason) {
    return {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
        output: { denied: true, reason }
    };
}
function wildcard(pattern, value) {
    if (pattern === '*')
        return true;
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(value);
}
