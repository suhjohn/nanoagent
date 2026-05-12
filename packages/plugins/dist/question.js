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
export function withQuestionTool(params) {
    const toolName = params.toolName ?? 'question';
    return withTool(toolName, defineTool({
        description: 'Ask user one to three short blocking questions. Use only when agent cannot continue from repository, runtime, or session context.',
        inputSchema: objectSchema({
            questions: {
                type: 'array',
                minItems: 1,
                maxItems: 3,
                items: objectSchema({
                    id: {
                        type: 'string',
                        description: 'Stable snake_case key used in answer map.'
                    },
                    header: {
                        type: 'string',
                        description: 'Short UI label.'
                    },
                    question: {
                        type: 'string',
                        description: 'Single concrete question.'
                    },
                    options: {
                        type: 'array',
                        items: objectSchema({
                            label: { type: 'string' },
                            description: { type: 'string' }
                        }, ['label'])
                    }
                }, ['id', 'header', 'question'])
            }
        }, ['questions']),
        execute: (input, options) => params.ask({
            input: parseQuestionInput(input),
            context: options.experimental_context,
            signal: options.abortSignal,
            toolCallId: options.toolCallId
        })
    }));
}
function parseQuestionInput(input) {
    const record = assertRecord(input, 'question');
    const rawQuestions = record.questions;
    if (!Array.isArray(rawQuestions) || rawQuestions.length < 1) {
        throw new Error('questions must contain at least one question.');
    }
    if (rawQuestions.length > 3) {
        throw new Error('questions must contain at most three questions.');
    }
    const questions = rawQuestions.map(rawQuestion => {
        const question = assertRecord(rawQuestion, 'question item');
        const options = question.options;
        return {
            id: stringField(question, 'id'),
            header: stringField(question, 'header'),
            question: stringField(question, 'question'),
            options: Array.isArray(options)
                ? options.map(option => {
                    const item = assertRecord(option, 'question option');
                    return {
                        label: stringField(item, 'label'),
                        description: stringField(item, 'description', false)
                    };
                })
                : undefined
        };
    });
    return { questions };
}
