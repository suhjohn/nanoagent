// @ts-nocheck
// Origin:
// - Pi: packages/agent/src/harness/prompt-templates.ts, coding-agent/src/core/prompt-templates.ts
// Behavior: load Markdown prompt templates, parse quoted args, and expand $1, $@, $ARGUMENTS substitutions.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
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
export async function loadPromptTemplates(dirs) {
    const templates = [];
    for (const dir of dirs) {
        const info = await stat(dir).catch(() => undefined);
        if (!info?.isDirectory())
            continue;
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.md'))
                continue;
            const filePath = path.join(dir, entry.name);
            const raw = await readFile(filePath, 'utf8');
            const { frontmatter, body } = frontmatterBlock(raw);
            templates.push({
                name: path.basename(entry.name, '.md'),
                description: typeof frontmatter.description === 'string'
                    ? frontmatter.description
                    : undefined,
                content: body,
                filePath
            });
        }
    }
    return templates;
}
export function expandPromptTemplate(template, args) {
    return template
        .replace(/\$\{@:([0-9]+):([0-9]+)\}/g, (_match, start, count) => args.slice(Number(start) - 1, Number(start) - 1 + Number(count)).join(' '))
        .replace(/\$\{@:([0-9]+)\}/g, (_match, start) => args.slice(Number(start) - 1).join(' '))
        .replace(/\$ARGUMENTS/g, args.join(' '))
        .replace(/\$@/g, args.join(' '))
        .replace(/\$([1-9][0-9]*)/g, (_match, index) => args[Number(index) - 1] ?? '');
}
export function withPromptTemplates(params) {
    let cached;
    return withTurnPrepared(async ({ args, value }) => {
        const input = params.getInput(args.context);
        if (!input?.startsWith('/'))
            return { value };
        const [command, ...rest] = parseArgs(input.slice(1));
        cached ??= loadPromptTemplates(params.dirs);
        const template = (await cached).find(template => template.name === command);
        if (!template)
            return { value };
        return {
            value: appendMessages(value, [
                message('user', expandPromptTemplate(template.content, rest))
            ])
        };
    });
}
function parseArgs(input) {
    return [...input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(match => match[1] ?? match[2] ?? match[3] ?? '');
}
function frontmatterBlock(raw) {
    if (!raw.startsWith('---\n'))
        return { frontmatter: {}, body: raw };
    const end = raw.indexOf('\n---\n', 4);
    if (end < 0)
        return { frontmatter: {}, body: raw };
    const frontmatter = {};
    for (const line of raw.slice(4, end).split('\n')) {
        const split = line.indexOf(':');
        if (split > 0)
            frontmatter[line.slice(0, split).trim()] = line.slice(split + 1).trim();
    }
    return { frontmatter, body: raw.slice(end + 5) };
}
