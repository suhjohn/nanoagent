export function withTurnQueue(params) {
    const take = params.mode === 'one-at-a-time' ? 1 : Number.POSITIVE_INFINITY;
    const drainSteering = withTurnPrepared(async ({ args, value }) => {
        const context = args.context;
        const steering = (await params.store.steering(context)).slice(0, take);
        const followUp = (await params.store.followUp(context)).slice(0, take);
        const messages = [...steering, ...followUp].map(text => userMessage(text));
        if (!messages.length)
            return { value };
        if (steering.length)
            await params.store.shiftSteering(context, steering.length);
        if (followUp.length)
            await params.store.shiftFollowUp(context, followUp.length);
        return { value: appendMessages(value, messages) };
    });
    return options => drainSteering(options);
}
function userMessage(content) {
    return { role: 'user', content };
}
function appendMessages(value, messages) {
    return {
        ...value,
        messages: [...(value.messages ?? []), ...messages]
    };
}
function withTurnPrepared(transform) {
    return options => ({
        ...options,
        hooks: {
            ...options.hooks,
            onTurnPrepared: async (args) => {
                const previous = (await options.hooks.onTurnPrepared(args));
                if (previous?.control)
                    return previous;
                const value = previous?.value;
                if (!value)
                    return previous;
                const next = await transform({
                    args: args,
                    value
                });
                return {
                    context: next?.context ?? previous?.context,
                    value: next?.value ?? value,
                    control: next?.control
                };
            }
        }
    });
}
