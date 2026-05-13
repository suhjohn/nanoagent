// Origin:
// - Pi: packages/coding-agent/src/core/session-manager.ts JSONL session replay
// - OpenCode: packages/opencode/src/session/session.ts message stream/page projection
// Behavior: load persisted transcript before current turn input and append assistant turns after completion.
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
export function createFileJsonlSessionRepo(params) {
    const dir = path.resolve(params.dir);
    return {
        entries: async (sessionId) => {
            const file = sessionFile(dir, sessionId, 'jsonl');
            const raw = await readFile(file, 'utf8').catch(error => {
                if (isNodeError(error) && error.code === 'ENOENT')
                    return '';
                throw error;
            });
            return raw
                .split('\n')
                .filter(line => line.trim())
                .map(line => parseJsonlEntry(JSON.parse(line)));
        },
        append: async (sessionId, entries) => {
            if (!entries.length)
                return;
            await mkdir(dir, { recursive: true });
            const lines = entries.map(entry => JSON.stringify(entry)).join('\n');
            await appendFile(sessionFile(dir, sessionId, 'jsonl'), `${lines}\n`);
        },
        saveRun: async (state) => {
            await mkdir(dir, { recursive: true });
            await writeFile(sessionFile(dir, state.runId, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
        }
    };
}
export function withJsonlSession(params) {
    const loadHistory = withTurnPrepared(async ({ value }) => {
        const entries = await params.repo.entries(params.sessionId);
        return { value: prependMessages(value, projectEntries(entries)) };
    });
    const recordAssistant = withTurnCompleted(async (args) => {
        const entry = {
            id: args.turn.turnId,
            type: 'custom',
            message: assistantMessage(args.turn.modelResult?.text ?? '')
        };
        await params.repo.append(params.sessionId, [entry]);
    });
    const saveRun = withSaveState(async ({ state }) => {
        await params.repo.saveRun?.(state);
    });
    return options => saveRun(recordAssistant(loadHistory(options)));
}
export function projectEntries(entries) {
    return entries.flatMap(entryToMessages);
}
function entryToMessages(entry) {
    switch (entry.type) {
        case 'message':
        case 'custom':
            return [entry.message];
        case 'compaction':
            return [systemMessage(`<compaction>\n${entry.summary}\n</compaction>`)];
        case 'branch':
            return [
                systemMessage(`<branch_summary>\n${entry.summary}\n</branch_summary>`)
            ];
    }
}
function assistantMessage(content) {
    return { role: 'assistant', content };
}
function systemMessage(content) {
    return { role: 'system', content };
}
function parseJsonlEntry(input) {
    const record = assertRecord(input, 'jsonl entry');
    const id = stringField(record, 'id');
    const type = stringField(record, 'type');
    switch (type) {
        case 'message':
        case 'custom':
            return { id, type, message: parseMessage(record.message) };
        case 'compaction':
        case 'branch':
            return { id, type, summary: stringField(record, 'summary') };
        default:
            throw new Error(`Unsupported JSONL session entry type: ${type}.`);
    }
}
function parseMessage(input) {
    const record = assertRecord(input, 'message');
    const role = stringField(record, 'role');
    if (role !== 'system' &&
        role !== 'user' &&
        role !== 'assistant' &&
        role !== 'tool') {
        throw new Error('message role must be system, user, assistant, or tool.');
    }
    return { role, content: record.content };
}
function sessionFile(dir, sessionId, extension) {
    return path.join(dir, `${safeSessionId(sessionId)}.${extension}`);
}
function safeSessionId(sessionId) {
    return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function prependMessages(value, messages) {
    return {
        ...value,
        messages: [...messages, ...(value.messages ?? [])]
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
function assertRecord(input, name) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error(`${name} must be an object.`);
    }
    return input;
}
function stringField(input, key) {
    const value = input[key];
    if (typeof value === 'string')
        return value;
    throw new Error(`${key} must be a string.`);
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
function withTurnCompleted(effect) {
    return options => ({
        ...options,
        hooks: {
            ...options.hooks,
            onTurnCompleted: async (args) => {
                const previous = (await options.hooks.onTurnCompleted?.(args));
                await effect(args);
                return previous;
            }
        }
    });
}
function withSaveState(effect) {
    return options => ({
        ...options,
        saveState: async (args) => {
            await options.saveState?.(args);
            await effect({ state: args.state });
        }
    });
}
