export function withSystemPrompt(content) {
    return withTurnPrepared(async ({ args, value }) => {
        const text = typeof content === 'string'
            ? content
            : await content(args.context);
        return { value: prependMessages(value, [message('system', text)]) };
    });
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
        const body = memories.map(item => `- ${item}`).join('\n');
        return {
            value: prependMessages(value, [message('system', `Memory:\n${body}`)])
        };
    });
}
export function withSkills(load) {
    return withTurnPrepared(async ({ args, value }) => {
        const skills = await load({ context: args.context });
        if (!skills.length)
            return { value };
        const body = skills
            .map(skill => `## ${skill.name}\n${skill.body}`)
            .join('\n\n');
        return {
            value: prependMessages(value, [
                message('system', `Available skills:\n${body}`)
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
        if (!(await params.shouldCompact({ context, value })))
            return { value };
        return {
            value: {
                ...value,
                messages: await params.compact({ context, value })
            }
        };
    });
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
                const next = await transform({ args, value });
                return {
                    context: next?.context ?? previous?.context,
                    value: next?.value ?? value,
                    control: next?.control
                };
            }
        }
    });
}
function message(role, content) {
    return { role, content };
}
function prependMessages(value, messages) {
    return {
        ...value,
        messages: [...messages, ...(value.messages ?? [])]
    };
}
function appendMessages(value, messages) {
    return {
        ...value,
        messages: [...(value.messages ?? []), ...messages]
    };
}
