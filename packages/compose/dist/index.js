function isHookResult(value) {
    return typeof value === 'object' && value !== null;
}
function hasControl(value) {
    return isHookResult(value) && value.control !== undefined;
}
function hasContext(value) {
    return isHookResult(value) && value.context !== undefined;
}
function hasValue(value) {
    return isHookResult(value) && value.value !== undefined;
}
function mergeHookResults(first, second) {
    if (!isHookResult(first)) {
        return second;
    }
    if (!isHookResult(second)) {
        return first;
    }
    return {
        ...(hasContext(first) ? { context: first.context } : {}),
        ...(hasValue(first) ? { value: first.value } : {}),
        ...(hasControl(first) ? { control: first.control } : {}),
        ...(hasContext(second) ? { context: second.context } : {}),
        ...(hasValue(second) ? { value: second.value } : {}),
        ...(hasControl(second) ? { control: second.control } : {})
    };
}
function chainHook(first, second) {
    if (!first) {
        return second;
    }
    if (!second) {
        return first;
    }
    return (async (args) => {
        const firstResult = await first(args);
        if (hasControl(firstResult)) {
            return firstResult;
        }
        const secondArgs = hasContext(firstResult)
            ? Object.assign({}, args, { context: firstResult.context })
            : args;
        const secondResult = await second(secondArgs);
        return mergeHookResults(firstResult, secondResult);
    });
}
function chainHooks(first, second) {
    return {
        onRunStarted: chainHook(first.onRunStarted, second.onRunStarted),
        onTurnStarted: chainHook(first.onTurnStarted, second.onTurnStarted),
        onTurnPrepared: chainHook(first.onTurnPrepared, second.onTurnPrepared),
        onModelStarted: chainHook(first.onModelStarted, second.onModelStarted),
        onModelRestarted: chainHook(first.onModelRestarted, second.onModelRestarted),
        onModelCompleted: chainHook(first.onModelCompleted, second.onModelCompleted),
        onPause: chainHook(first.onPause, second.onPause),
        onStreamUpdate: chainHook(first.onStreamUpdate, second.onStreamUpdate),
        onToolCallsStarted: chainHook(first.onToolCallsStarted, second.onToolCallsStarted),
        onToolCallStarted: chainHook(first.onToolCallStarted, second.onToolCallStarted),
        onToolCallCompleted: chainHook(first.onToolCallCompleted, second.onToolCallCompleted),
        onToolCallsCompleted: chainHook(first.onToolCallsCompleted, second.onToolCallsCompleted),
        onTurnCompleted: chainHook(first.onTurnCompleted, second.onTurnCompleted),
        onRunCompleted: chainHook(first.onRunCompleted, second.onRunCompleted),
        onRunFailed: chainHook(first.onRunFailed, second.onRunFailed)
    };
}
function mergeMiddleware(first, second) {
    return {
        callModel: [...(first?.callModel ?? []), ...(second.callModel ?? [])],
        callTool: [...(first?.callTool ?? []), ...(second.callTool ?? [])]
    };
}
export async function withPlugins(options, plugins) {
    let next = options;
    for (const plugin of plugins) {
        next = await plugin(next);
    }
    return next;
}
export function withTools(tools) {
    return options => ({
        ...options,
        tools: {
            ...(options.tools ?? {}),
            ...tools
        }
    });
}
export function withModelProviders(modelProviders) {
    return options => ({
        ...options,
        modelProviders: {
            ...(options.modelProviders ?? {}),
            ...modelProviders
        }
    });
}
export function withHooks(hooks) {
    return options => ({
        ...options,
        hooks: chainHooks(options.hooks, hooks)
    });
}
export function withMiddleware(middleware) {
    return options => ({
        ...options,
        middleware: mergeMiddleware(options.middleware, middleware)
    });
}
export function withSaveState(saveState) {
    return options => ({
        ...options,
        saveState
    });
}
