#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runAgent } from '../../kernel/dist/index.js';
import { createFileJsonlSessionRepo, withJsonlSession, withPlanTool, withProjectContext, withPromptTemplates, withQuestionTool, withTodoWriteTool, withToolErrorBoundary } from './index.js';
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const root = path.resolve(args.root);
    const stateDir = path.resolve(args.stateDir);
    const sessionDir = path.join(stateDir, 'sessions');
    const templateDir = path.join(stateDir, 'templates');
    const notesFile = path.join(stateDir, `${safeName(args.sessionId)}.notes.json`);
    await mkdir(templateDir, { recursive: true });
    await ensureDefaultTemplate(templateDir);
    const notes = await readNotes(notesFile);
    const repo = createFileJsonlSessionRepo({ dir: sessionDir });
    await repo.append(args.sessionId, [
        {
            id: `user-${Date.now()}`,
            type: 'message',
            message: { role: 'user', content: args.message }
        }
    ]);
    let toolRounds = 0;
    const options = compose(withProjectContext({ cwd: root }), withPromptTemplates({
        dirs: [templateDir],
        getInput: context => context.message
    }), withJsonlSession({ sessionId: args.sessionId, repo }), withPlanTool({
        update: params => {
            notes.plans.push(params.input);
            return { ok: true, plan: params.input.plan };
        }
    }), withTodoWriteTool({
        update: params => {
            notes.todos.push(params.todos);
        }
    }), withQuestionTool({
        ask: params => {
            const answers = Object.fromEntries(params.input.questions.map(question => [
                question.id,
                question.options[0]?.label ?? ''
            ]));
            notes.answers.push({ questions: params.input.questions, answers });
            return { answers };
        }
    }), withToolErrorBoundary(args => args.error))({
        state: { context: { sessionId: args.sessionId, message: args.message } },
        maxTurns: 4,
        hooks: {
            onTurnPrepared: () => ({
                value: {
                    model: args.model,
                    system: [
                        'You are running inside nano-plugin-chat.',
                        'Use available tools when they help complete user request.',
                        toolRounds > 0
                            ? 'Tool calls for this user message are complete. Do not call tools again. Return final answer now.'
                            : '',
                        'Keep final answer concise and concrete.'
                    ]
                        .filter(Boolean)
                        .join('\n'),
                    toolChoice: toolRounds > 0 ? 'none' : 'auto',
                    messages: []
                }
            }),
            onToolCallsCompleted: () => {
                toolRounds += 1;
            }
        }
    });
    let printedText = false;
    const textTurns = new Set();
    for await (const event of runAgent(options)) {
        printEvent(event, {
            hasTurnText: turn => textTurns.has(turn),
            onText: text => {
                printedText = true;
                process.stdout.write(text);
            },
            markTurnText: turn => {
                textTurns.add(turn);
            }
        });
    }
    if (printedText)
        process.stdout.write('\n');
    await writeFile(notesFile, `${JSON.stringify(notes, null, 2)}\n`);
}
function printEvent(event, handlers) {
    if (event.type === 'stream_part') {
        const part = event.part;
        const delta = part.delta ?? part.textDelta;
        if (part.type === 'text-delta' && delta) {
            handlers.markTurnText(event.turn);
            handlers.onText(delta);
        }
        if (part.type === 'tool-call' && part.toolName) {
            process.stderr.write(`\n[tool-call] ${part.toolName}\n`);
        }
        return;
    }
    if (event.type === 'tool_call_completed') {
        const suffix = 'error' in event ? ' error' : '';
        process.stderr.write(`[tool-completed] ${event.toolName}${suffix}\n`);
    }
    if (event.type === 'model_completed' &&
        event.result.text &&
        !handlers.hasTurnText(event.turn.turn)) {
        handlers.markTurnText(event.turn.turn);
        handlers.onText(event.result.text);
    }
}
async function ensureDefaultTemplate(templateDir) {
    const file = path.join(templateDir, 'echo.md');
    try {
        await readFile(file, 'utf8');
    }
    catch {
        await writeFile(file, 'Template expanded: $ARGUMENTS\n');
    }
}
async function readNotes(file) {
    try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        return {
            plans: Array.isArray(parsed.plans) ? parsed.plans : [],
            todos: Array.isArray(parsed.todos) ? parsed.todos : [],
            answers: Array.isArray(parsed.answers) ? parsed.answers : []
        };
    }
    catch {
        return { plans: [], todos: [], answers: [] };
    }
}
function compose(...plugins) {
    return options => plugins.reduce((next, plugin) => plugin(next), options);
}
function parseArgs(argv) {
    const values = [...argv];
    const sessionId = takeFlag(values, '--session') ?? 'default';
    const model = takeFlag(values, '--model') ?? 'openai/gpt-5.4-mini';
    const root = takeFlag(values, '--root') ?? process.cwd();
    const stateDir = takeFlag(values, '--state-dir') ?? '.nano-plugin-chat';
    const message = values.join(' ').trim();
    if (!message) {
        throw new Error('Usage: bun run plugin-chat -- --session <id> [--model openai/gpt-5.4-mini] [--root <dir>] [--state-dir <dir>] <message>');
    }
    return { sessionId, model, root, stateDir, message };
}
function takeFlag(values, name) {
    const index = values.indexOf(name);
    if (index < 0)
        return undefined;
    const value = values[index + 1];
    if (!value)
        throw new Error(`${name} requires a value.`);
    values.splice(index, 2);
    return value;
}
function safeName(value) {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
