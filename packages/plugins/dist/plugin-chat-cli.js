#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runAgent } from '../../kernel/dist/index.js';
import { createEnvModelAuthStore, createFileJsonlSessionRepo, createMemoryGoalStore, withApplyPatchTool, withCodexCompaction, withCodexSkills, withCodingTools, withDiscoveredSkills, withEventSink, withFileMutationQueue, withGoalTools, withJsonlSession, withLspTool, withMemory, withMcpTools, withModelAuth, withModelFallback, withModelResultMapper, withModelRetry, withOpenCodeCompaction, withOpenCodeSkills, withPermissionRules, withPlanTool, withProjectContext, withPromptMessages, withPromptTemplates, withQuestionTool, withRequestPermissionsTool, withRevertTools, withSandboxPolicy, withSessionStore, withShareSync, withShellTool, withSkills, withSlashCommands, withSnapshots, withSubagentTools, withTaskTool, withTodoWriteTool, withToolErrorBoundary, withTranscriptRecorder } from './index.js';
const SCENARIOS = [
    'core',
    'coding',
    'orchestration',
    'knowledge',
    'lsp',
    'compaction'
];
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const scenarios = args.scenario === 'all' ? SCENARIOS : [args.scenario];
    for (const scenario of scenarios) {
        await runScenario({
            ...args,
            scenario,
            sessionId: args.scenario === 'all'
                ? `${args.sessionId}-${scenario}`
                : args.sessionId
        });
    }
}
async function runScenario(args) {
    const root = path.resolve(args.root);
    const stateDir = path.resolve(args.stateDir);
    const sessionDir = path.join(stateDir, 'sessions');
    const templateDir = path.join(stateDir, 'templates');
    const workspace = path.join(stateDir, 'workspaces', args.scenario);
    const runDir = path.join(stateDir, 'runs');
    const artifactsFile = path.join(runDir, `${args.sessionId}.json`);
    const logFile = path.join(runDir, `${args.sessionId}.jsonl`);
    await mkdir(templateDir, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(runDir, { recursive: true });
    await ensureDefaultTemplate(templateDir);
    const artifacts = emptyArtifacts();
    const emit = (record) => {
        const entry = {
            scenario: args.scenario,
            createdAt: new Date().toISOString(),
            ...record
        };
        artifacts.trace.push(entry);
        if (args.traceJson)
            process.stdout.write(`${JSON.stringify(entry)}\n`);
    };
    const scenario = await buildScenario({
        args,
        root,
        stateDir,
        templateDir,
        workspace,
        artifacts,
        emit
    });
    const prompt = args.message ?? scenario.prompt;
    const repo = createFileJsonlSessionRepo({ dir: sessionDir });
    await repo.append(args.sessionId, [
        {
            id: `user-${Date.now()}`,
            type: 'message',
            message: { role: 'user', content: prompt }
        }
    ]);
    emit({ type: 'scenario_started', model: args.model, prompt });
    let toolRounds = 0;
    const base = {
        state: {
            context: {
                sessionId: args.sessionId,
                message: prompt,
                scenario: args.scenario,
                workspace
            }
        },
        maxTurns: scenario.maxToolRounds + 2,
        hooks: {
            onTurnPrepared: () => ({
                value: {
                    model: args.model,
                    system: [
                        `You are running nano plugin CLI scenario "${args.scenario}".`,
                        scenario.system(toolRounds),
                        toolRounds >= scenario.maxToolRounds
                            ? 'Tool rounds are complete. Do not call tools again. Return final answer now.'
                            : 'Follow scenario tool instructions exactly. Prefer one tool round per instruction step.',
                        'Return concise final answer naming completed scenario.'
                    ].join('\n'),
                    toolChoice: toolRounds < scenario.maxToolRounds ? 'required' : 'none',
                    messages: []
                }
            }),
            onToolCallsCompleted: () => {
                toolRounds += 1;
                emit({ type: 'tool_round_completed', toolRounds });
            }
        }
    };
    const options = compose(...commonPlugins({ args, artifacts, emit }), ...scenario.plugins, withJsonlSession({ sessionId: args.sessionId, repo }), withTraceHooks({ artifacts, emit }))(base);
    const textTurns = new Set();
    for await (const event of runAgent(options)) {
        printEvent(event, {
            traceJson: args.traceJson,
            hasTurnText: turn => textTurns.has(turn),
            markTurnText: turn => textTurns.add(turn),
            onText: text => {
                artifacts.assistantText += text;
                if (!args.traceJson)
                    process.stdout.write(text);
            },
            emit
        });
    }
    if (!args.traceJson && artifacts.assistantText)
        process.stdout.write('\n');
    emit({
        type: 'scenario_completed',
        traceRecords: artifacts.trace.length,
        assistantText: artifacts.assistantText
    });
    await writeFile(artifactsFile, `${JSON.stringify(artifacts, null, 2)}\n`);
    await writeFile(logFile, `${artifacts.trace.map(record => JSON.stringify(record)).join('\n')}\n`);
}
async function buildScenario(params) {
    if (params.args.scenario === 'core')
        return coreScenario(params);
    if (params.args.scenario === 'coding')
        return codingScenario(params);
    if (params.args.scenario === 'orchestration') {
        return orchestrationScenario(params);
    }
    if (params.args.scenario === 'knowledge')
        return knowledgeScenario(params);
    if (params.args.scenario === 'lsp')
        return lspScenario(params);
    return compactionScenario(params);
}
async function coreScenario(params) {
    const goalStore = createMemoryGoalStore();
    return {
        name: 'core',
        maxToolRounds: 3,
        prompt: 'Run core plugin scenario. Follow system instructions for each tool round.',
        system: round => [
            'Round 0: call only create_goal with objective "core CLI scenario" and token_budget 1000.',
            'Round 1: call update_plan, todowrite, request_user_input, and get_goal.',
            'Round 2: call update_goal with status "complete".',
            'After round 2, final answer: "core scenario complete".'
        ][round] ?? 'Final answer only.',
        plugins: [
            withProjectContext({ cwd: params.root }),
            withPromptTemplates({
                dirs: [params.templateDir],
                getInput: context => context.message
            }),
            withPlanTool({
                update: update => {
                    params.artifacts.plans.push(update.input);
                    return { ok: true, plan: update.input.plan };
                }
            }),
            withTodoWriteTool({
                update: update => {
                    params.artifacts.todos.push(update.todos);
                }
            }),
            withQuestionTool({
                ask: ask => {
                    const answers = Object.fromEntries(ask.input.questions.map(question => [
                        question.id,
                        { answers: [question.options[0]?.label ?? ''] }
                    ]));
                    params.artifacts.answers.push({
                        questions: ask.input.questions,
                        answers
                    });
                    return { answers };
                }
            }),
            withGoalTools({ store: goalStore })
        ]
    };
}
async function codingScenario(params) {
    await writeFile(path.join(params.workspace, 'existing.txt'), 'alpha\nbeta\n');
    return {
        name: 'coding',
        maxToolRounds: 9,
        prompt: 'Run coding plugin scenario. Follow system instructions for each tool round.',
        system: round => [
            'Round 0: call only request_permissions for permission "filesystem", patterns ["*"], reason "coding scenario".',
            'Round 1: call only bash with cmd "pwd".',
            'Round 2: call only shell with cmd "pwd".',
            'Round 3: call only write to create created.txt containing "hello from real model\\n".',
            'Round 4: call only apply_patch with a valid Begin Patch patch adding patched.txt containing "patched by real model".',
            'Round 5: call only edit on created.txt replacing "hello" with "updated".',
            'Round 6: call only read on created.txt.',
            'Round 7: call only ls with path "." recursive true.',
            'Round 8: call only grep for pattern "updated" caseSensitive false.',
            'Final answer only: "coding scenario complete".'
        ][round] ?? 'Final answer only.',
        plugins: [
            withCodingTools({
                cwd: params.workspace,
                enabled: ['read', 'write', 'list', 'grep', 'shell', 'patch']
            }),
            withApplyPatchTool({ root: params.workspace }),
            withShellTool({ cwd: params.workspace, toolName: 'shell' }),
            withRequestPermissionsTool({
                grant: grant => {
                    params.artifacts.permissions.push({
                        tool: 'request_permissions',
                        grant
                    });
                    return { granted: true, grant };
                }
            }),
            withPermissionRules({
                rules: [],
                request: request => {
                    params.artifacts.permissions.push({ tool: 'middleware', request });
                    return { action: 'allow', remember: true };
                }
            }),
            withSandboxPolicy({
                policy: site => ({ mode: 'workspace_write', tool: site.toolName }),
                run: run => {
                    params.artifacts.sandbox.push(run);
                    params.emit({
                        type: 'sandbox_policy',
                        toolName: run.toolName,
                        policy: run.policy
                    });
                },
                retryWithoutSandbox: retry => {
                    params.artifacts.sandbox.push({ retry });
                    return false;
                }
            }),
            withSnapshots({
                capture: site => {
                    const snapshot = { toolName: site.toolName, input: site.input };
                    params.artifacts.snapshots.push({ phase: 'capture', snapshot });
                    return snapshot;
                },
                diff: diff => {
                    const result = { toolName: diff.toolName, changed: true };
                    params.artifacts.snapshots.push({ phase: 'diff', result });
                    return result;
                },
                restore: restore => {
                    params.artifacts.snapshots.push({ phase: 'restore', restore });
                }
            }),
            withFileMutationQueue(),
            withToolErrorBoundary(error => error.error)
        ]
    };
}
async function orchestrationScenario(params) {
    let spawned = 0;
    const subagentHost = {
        spawn: async (args) => {
            spawned += 1;
            const result = { id: `agent-${spawned}`, status: 'running' };
            params.artifacts.subagents.push({ action: 'spawn', args, result });
            return result;
        },
        send: async (args) => {
            params.artifacts.subagents.push({ action: 'send', args });
            return { ok: true };
        },
        wait: async (args) => {
            params.artifacts.subagents.push({ action: 'wait', args });
            return { completed: [{ id: 'agent-1', output: 'subagent done' }] };
        },
        resume: async (args) => {
            params.artifacts.subagents.push({ action: 'resume', args });
            return { ok: true };
        },
        close: async (args) => {
            params.artifacts.subagents.push({ action: 'close', args });
            return { closed: true };
        }
    };
    const mcpPlugin = await withMcpTools({
        listTools: () => [
            {
                server: 'demo',
                name: 'lookup',
                description: 'Lookup demo data.',
                inputSchema: {
                    type: 'object',
                    properties: { query: { type: 'string' } },
                    required: ['query'],
                    additionalProperties: false
                }
            }
        ],
        callTool: call => {
            params.artifacts.mcp.push({ action: 'callTool', call });
            return { result: `lookup:${call.input}` };
        },
        listResources: () => [{ uri: 'demo://resource', name: 'demo' }],
        readResource: uri => {
            params.artifacts.mcp.push({ action: 'readResource', uri });
            return { uri, text: 'demo resource' };
        }
    });
    return {
        name: 'orchestration',
        maxToolRounds: 11,
        prompt: 'Run orchestration plugin scenario. Follow system instructions for each tool round.',
        system: round => [
            'Round 0: call only mcp__demo__lookup with query "alpha".',
            'Round 1: call only mcp_read_resource with uri "demo://resource".',
            'Round 2: call only task with subagent_type "worker", description "orchestration task", prompt "perform orchestration task".',
            'Round 3: call only revert_session with sessionId "s1" and messageId "m1".',
            'Round 4: call only spawn_agent with message "inspect orchestration scenario". Do not include fork_context, agent_type, model, or reasoning_effort.',
            'Round 5: call only send_input with target "agent-1" and message "continue".',
            'Round 6: call only wait_agent with targets ["agent-1"] and timeout_ms 10000.',
            'Round 7: call only close_agent with target "agent-1".',
            'Round 8: call only resume_agent with id "agent-1".',
            'Round 9: call only close_agent with target "agent-1".',
            'Round 10: call only unrevert_session with sessionId "s1".',
            'Final answer only: "orchestration scenario complete".'
        ][round] ?? 'Final answer only.',
        plugins: [
            mcpPlugin,
            withTaskTool({
                agents: () => [{ name: 'worker', role: 'test-worker' }],
                run: async (run) => {
                    const result = {
                        taskId: run.taskId ?? 'task-1',
                        output: `task complete:${run.prompt}`,
                        metadata: { agent: run.agent.name }
                    };
                    params.artifacts.tasks.push({ run, result });
                    return result;
                }
            }),
            withSubagentTools(subagentHost),
            withRevertTools({
                store: {
                    revert: args => {
                        params.artifacts.reverts.push({ action: 'revert', args });
                        return { reverted: args.messageId };
                    },
                    unrevert: args => {
                        params.artifacts.reverts.push({ action: 'unrevert', args });
                        return { unreverted: args.sessionId };
                    }
                }
            }),
            withToolErrorBoundary(error => error.error)
        ]
    };
}
async function knowledgeScenario(params) {
    await writeSkill({
        file: path.join(params.workspace, 'skills', 'open-alpha', 'SKILL.md'),
        name: 'open-alpha',
        description: 'Generic alpha instructions.',
        body: 'Generic alpha body.'
    });
    await writeSkill({
        file: path.join(params.workspace, 'opencode-skills', 'open-alpha', 'SKILL.md'),
        name: 'open-alpha',
        description: 'OpenCode alpha instructions.',
        body: 'OpenCode alpha body.'
    });
    await writeSkill({
        file: path.join(params.workspace, '.codex', 'skills', 'open-alpha', 'SKILL.md'),
        name: 'open-alpha',
        description: 'Codex alpha instructions.',
        body: 'Codex alpha body.'
    });
    await mkdir(path.join(params.workspace, 'src'), { recursive: true });
    await writeFile(path.join(params.workspace, 'src', 'sample.ts'), 'export function alpha() { return 1 }\n');
    const lspClient = {
        hasClient: async () => true,
        touchFile: async (file, diagnostics) => {
            params.artifacts.lsp.push({ action: 'touchFile', file, diagnostics });
        },
        operation: async (operation) => {
            params.artifacts.lsp.push({ action: 'operation', operation });
            return [{ name: 'alpha', kind: 'function' }];
        },
        diagnostics: async (file) => {
            params.artifacts.lsp.push({ action: 'diagnostics', file });
            return [];
        },
        close: async () => {
            params.artifacts.lsp.push({ action: 'close' });
        }
    };
    return {
        name: 'knowledge',
        maxToolRounds: 2,
        prompt: 'Run knowledge plugin scenario using $open-alpha. Follow system instructions.',
        system: round => [
            'Round 0: call only skill with name "open-alpha".',
            'Round 1: call only lsp with operation "documentSymbol", filePath "src/sample.ts", line 1, character 17.',
            'Final answer only: "knowledge scenario complete".'
        ][round] ?? 'Final answer only.',
        plugins: [
            withPromptMessages(() => [
                { role: 'user', content: 'loaded prompt message' }
            ]),
            withMemory(() => ['remembered project fact']),
            withSkills(() => [{ name: 'inline-skill', body: 'Inline skill body.' }]),
            withSlashCommands(() => [
                { role: 'user', content: 'expanded slash command' }
            ]),
            withDiscoveredSkills({ dirs: [path.join(params.workspace, 'skills')] }),
            withOpenCodeSkills({
                cwd: params.workspace,
                dirs: [path.join(params.workspace, 'opencode-skills')],
                includeGlobal: false,
                includeProjectAncestors: false
            }),
            withCodexSkills({ cwd: params.workspace }),
            withLspTool({ cwd: params.workspace, client: lspClient })
        ]
    };
}
async function compactionScenario(params) {
    const store = {
        latest: async () => undefined,
        save: async (_context, entry) => {
            params.artifacts.compactions.push(entry);
        }
    };
    return {
        name: 'compaction',
        maxToolRounds: 0,
        prompt: 'Run compaction plugin scenario. This message intentionally contains enough repeated content to trigger compaction. alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau.',
        system: () => 'No tools. Respond "compaction scenario complete".',
        plugins: [
            withPromptMessages(() => [
                { role: 'user', content: 'historical message one '.repeat(40) },
                { role: 'assistant', content: 'historical message two '.repeat(40) },
                { role: 'user', content: 'historical message three '.repeat(40) }
            ]),
            withOpenCodeCompaction({
                store,
                maxTokens: 20,
                preserveRecentTokens: 4,
                tailTurns: 0,
                trigger: 'manual',
                summarize: async (args) => {
                    params.artifacts.compactions.push({
                        action: 'opencode_summarize',
                        count: args.messages.length,
                        trigger: args.trigger
                    });
                    return 'opencode compacted summary';
                }
            }),
            withCodexCompaction({
                store,
                maxTokens: 20,
                trigger: 'manual',
                summarize: async (args) => {
                    params.artifacts.compactions.push({
                        action: 'codex_summarize',
                        count: args.messages.length,
                        trigger: args.trigger
                    });
                    return 'codex compacted summary';
                }
            })
        ]
    };
}
async function lspScenario(params) {
    await mkdir(path.join(params.workspace, 'src'), { recursive: true });
    await writeFile(path.join(params.workspace, 'src', 'sample.ts'), 'export function alpha() { return 1 }\n');
    const lspClient = {
        hasClient: async () => true,
        touchFile: async (file, diagnostics) => {
            params.artifacts.lsp.push({ action: 'touchFile', file, diagnostics });
        },
        operation: async (operation) => {
            params.artifacts.lsp.push({ action: 'operation', operation });
            return [{ name: 'alpha', kind: 'function' }];
        },
        diagnostics: async (file) => {
            params.artifacts.lsp.push({ action: 'diagnostics', file });
            return [];
        },
        close: async () => {
            params.artifacts.lsp.push({ action: 'close' });
        }
    };
    return {
        name: 'lsp',
        maxToolRounds: 1,
        prompt: 'Run LSP plugin scenario. Follow system instructions.',
        system: round => round === 0
            ? 'Round 0: call only lsp with operation "documentSymbol", filePath "src/sample.ts", line 1, character 17.'
            : 'Final answer only: "lsp scenario complete".',
        plugins: [withLspTool({ cwd: params.workspace, client: lspClient })]
    };
}
function commonPlugins(params) {
    return [
        withModelAuth({
            auth: createEnvModelAuthStore(),
            apply: auth => {
                params.artifacts.modelAuth.push({
                    provider: auth.provider,
                    tokenPresent: Boolean(auth.token)
                });
                params.emit({ type: 'model_auth', provider: auth.provider });
            }
        }),
        withModelRetry({ attempts: 1 }),
        withModelFallback([params.args.model]),
        withModelResultMapper(({ result }) => {
            params.artifacts.modelResults.push({
                model: result.args.model,
                finishReason: result.result.finishReason,
                text: result.result.text,
                toolCalls: result.pendingToolCalls.map(call => call.toolName)
            });
            return result;
        }),
        withShareSync({
            client: {
                sync: payload => {
                    params.artifacts.shares.push({
                        events: payload.events.map(event => event.type),
                        status: payload.state.status.type
                    });
                }
            }
        }),
        withSessionStore({
            save: payload => {
                params.artifacts.sessions.push({
                    events: payload.events.map(event => event.type),
                    revision: payload.state.revision,
                    status: payload.state.status.type
                });
            }
        }),
        withEventSink(event => {
            params.emit({ type: 'event_sink', eventType: event.type });
        }),
        withTranscriptRecorder(transcript => {
            params.artifacts.transcripts.push({
                turnId: transcript.turnId,
                status: transcript.state.status.type
            });
        })
    ];
}
function withTraceHooks(params) {
    return options => ({
        ...options,
        hooks: {
            ...options.hooks,
            onTurnPrepared: args => {
                params.emit({
                    type: 'hook',
                    hook: 'onTurnPrepared',
                    turn: args.turn.turn,
                    toolCount: Object.keys(options.tools ?? {}).length
                });
                return options.hooks.onTurnPrepared(args);
            },
            onModelStarted: args => {
                params.emit({
                    type: 'hook',
                    hook: 'onModelStarted',
                    turn: args.turn.turn,
                    model: args.args.model,
                    tools: args.args.toolNames
                });
                return options.hooks.onModelStarted?.(args);
            },
            onStreamUpdate: args => {
                const part = args.part;
                if (part.type === 'tool-call' || part.type === 'tool-input-start') {
                    params.emit({
                        type: 'hook',
                        hook: 'onStreamUpdate',
                        partType: part.type,
                        toolName: part.toolName
                    });
                }
                return options.hooks.onStreamUpdate?.(args);
            },
            onModelCompleted: args => {
                params.emit({
                    type: 'hook',
                    hook: 'onModelCompleted',
                    turn: args.turn.turn,
                    finishReason: args.result.finishReason,
                    text: args.result.text ?? '',
                    pendingTools: args.turn.toolCalls.pending.map(call => call.toolName)
                });
                return options.hooks.onModelCompleted?.(args);
            },
            onToolCallStarted: args => {
                params.emit({
                    type: 'hook',
                    hook: 'onToolCallStarted',
                    turn: args.turn.turn,
                    toolName: args.toolName,
                    input: args.input
                });
                return options.hooks.onToolCallStarted?.(args);
            },
            onToolCallCompleted: args => {
                params.emit({
                    type: 'hook',
                    hook: 'onToolCallCompleted',
                    turn: args.turn.turn,
                    toolName: args.toolName,
                    output: 'output' in args ? args.output : undefined,
                    error: 'error' in args ? String(args.error) : undefined
                });
                return options.hooks.onToolCallCompleted?.(args);
            },
            onToolCallsCompleted: args => {
                params.emit({
                    type: 'hook',
                    hook: 'onToolCallsCompleted',
                    turn: args.turn.turn,
                    tools: args.toolCalls.map(call => call.toolName)
                });
                return options.hooks.onToolCallsCompleted?.(args);
            },
            onTurnCompleted: args => {
                params.emit({
                    type: 'hook',
                    hook: 'onTurnCompleted',
                    turn: args.turn.turn,
                    text: args.turn.modelResult?.text ?? ''
                });
                return options.hooks.onTurnCompleted?.(args);
            },
            onRunCompleted: args => {
                params.emit({
                    type: 'hook',
                    hook: 'onRunCompleted',
                    status: args.state.status,
                    turns: args.turns.length
                });
                return options.hooks.onRunCompleted?.(args);
            },
            onRunFailed: args => {
                params.emit({
                    type: 'hook',
                    hook: 'onRunFailed',
                    error: args.error instanceof Error
                        ? args.error.message
                        : String(args.error)
                });
                return options.hooks.onRunFailed?.(args);
            }
        }
    });
}
function printEvent(event, handlers) {
    if (event.type === 'stream_part') {
        const part = event.part;
        const delta = part.delta ?? part.textDelta;
        if (part.type === 'text-delta' && delta) {
            handlers.markTurnText(event.turn);
            handlers.onText(delta);
            if (handlers.traceJson) {
                handlers.emit({ type: 'assistant_text_delta', turn: event.turn, delta });
            }
        }
        if (part.type === 'tool-call' && part.toolName) {
            handlers.emit({
                type: 'stream_tool_call',
                turn: event.turn,
                toolName: part.toolName
            });
            if (!handlers.traceJson) {
                process.stderr.write(`\n[tool-call] ${part.toolName}\n`);
            }
        }
        return;
    }
    if (event.type === 'tool_call_completed' && !handlers.traceJson) {
        const suffix = 'error' in event ? ' error' : '';
        process.stderr.write(`[tool-completed] ${event.toolName}${suffix}\n`);
    }
    if (event.type === 'model_completed' &&
        event.result.text &&
        !handlers.hasTurnText(event.turn.turn)) {
        handlers.markTurnText(event.turn.turn);
        handlers.onText(event.result.text);
        if (handlers.traceJson) {
            handlers.emit({
                type: 'assistant_text',
                turn: event.turn.turn,
                text: event.result.text
            });
        }
    }
}
function emptyArtifacts() {
    return {
        plans: [],
        todos: [],
        answers: [],
        permissions: [],
        sandbox: [],
        snapshots: [],
        modelAuth: [],
        modelResults: [],
        shares: [],
        sessions: [],
        transcripts: [],
        tasks: [],
        subagents: [],
        mcp: [],
        reverts: [],
        lsp: [],
        compactions: [],
        trace: [],
        assistantText: ''
    };
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
async function writeSkill(params) {
    await mkdir(path.dirname(params.file), { recursive: true });
    await writeFile(params.file, [
        '---',
        `name: ${params.name}`,
        `description: ${params.description}`,
        '---',
        params.body
    ].join('\n'));
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
    const scenario = parseScenario(takeFlag(values, '--scenario') ?? 'core');
    const traceJson = takeBooleanFlag(values, '--trace-json');
    const message = values.join(' ').trim() || undefined;
    if (!message && scenario !== 'all') {
        return { sessionId, model, root, stateDir, scenario, traceJson };
    }
    return { sessionId, model, root, stateDir, scenario, traceJson, message };
}
function parseScenario(value) {
    if (value === 'all')
        return value;
    if (SCENARIOS.includes(value)) {
        return value;
    }
    throw new Error(`Unknown scenario "${value}". Expected all or ${SCENARIOS.join(', ')}.`);
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
function takeBooleanFlag(values, name) {
    const index = values.indexOf(name);
    if (index < 0)
        return false;
    values.splice(index, 1);
    return true;
}
main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
