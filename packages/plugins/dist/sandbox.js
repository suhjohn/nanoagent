export function withSandboxPolicy(params) {
    return appendCallToolMiddleware(async ({ input, next }) => {
        const site = toCallSite(input);
        const policy = await resolvePolicy(params.policy, site);
        await params.run?.({ ...site, policy });
        const response = await next(input);
        if (!shouldRetry(response, policy))
            return response;
        const retry = await params.retryWithoutSandbox?.({
            ...site,
            policy,
            error: response.error
        });
        return retry ? next(input) : response;
    });
}
function toCallSite(input) {
    return {
        toolName: input.toolCall.toolName,
        input: input.toolCall.input,
        context: input.context
    };
}
async function resolvePolicy(policy, site) {
    return typeof policy === 'function' ? policy(site) : policy;
}
function shouldRetry(response, policy) {
    return ('error' in response &&
        response.error !== undefined &&
        policy.mode !== 'danger_full_access');
}
function appendCallToolMiddleware(middleware) {
    return options => ({
        ...options,
        middleware: {
            ...options.middleware,
            callTool: [...(options.middleware?.callTool ?? []), middleware]
        }
    });
}
