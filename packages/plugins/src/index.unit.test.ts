// @ts-nocheck
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'bun:test'
import type {
  AgentModelCompletedArgs,
  AgentTurnStartedArgs,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'
import {
  collectSkillMentions,
  createNodeLspClient,
  applyPatch,
  withFilesystemTools,
  withCodexCompaction,
  withCodexSkills,
  diagnosticsAfterEdit,
  createMemoryGoalStore,
  withModelRetry,
  withGoalTools,
  withLspTool,
  withOpenCodeCompaction,
  withOpenCodeSkills,
  withPlanTool,
  withQuestionTool,
  withShellTool,
  withSystemPrompt,
  withToolConcurrency,
  withToolPermission
} from './index.js'

type Context = { id: string }

function options(): RunAgentOptions<Context> {
  return {
    state: { context: { id: 'ctx' } },
    maxTurns: 1,
    hooks: {
      onTurnPrepared: () => ({
        value: {
          model: 'test/model',
          messages: [{ role: 'user', content: 'hello' }]
        }
      })
    }
  }
}

describe('plugins', () => {
  test('question tool owns prompt schema and validates input', async () => {
    const plugin = withQuestionTool<Context>({
      ask: ({ input, context }) => ({
        answers: { [input.questions[0]?.id ?? 'missing']: context?.id ?? '' }
      })
    })
    const configured = plugin(options())
    const output = await configured.tools!.question!.execute!(
      {
        questions: [{ id: 'choice', header: 'Choice', question: 'Pick one?' }]
      },
      {
        toolCallId: 'call',
        messages: [],
        experimental_context: { id: 'ctx' }
      }
    )

    expect(output).toEqual({ answers: { choice: 'ctx' } })
    expect(configured.tools!.question!.description).toContain('Ask user')
  })

  test('plan tool rejects multiple active items', async () => {
    const configured = withPlanTool<Context>({
      update: async () => ({ ok: true })
    })(options())

    await expect(async () => {
      await configured.tools!.plan!.execute!(
        {
          plan: [
            { step: 'a', status: 'in_progress' },
            { step: 'b', status: 'in_progress' }
          ]
        },
        { toolCallId: 'call', messages: [] }
      )
    }).toThrow('at most one')
  })

  test('filesystem tools execute inside root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'plugins-'))
    const configured = withFilesystemTools<Context>({ root })(options())

    await configured.tools!.write_file!.execute!(
      { path: 'src/a.txt', content: 'hello\nworld\n' },
      { toolCallId: 'write', messages: [] }
    )
    const content = await readFile(path.join(root, 'src/a.txt'), 'utf8')
    const read = await configured.tools!.read_file!.execute!(
      { path: 'src/a.txt' },
      { toolCallId: 'read', messages: [] }
    )
    const grep = await configured.tools!.grep_files!.execute!(
      { pattern: 'world', path: 'src' },
      { toolCallId: 'grep', messages: [] }
    )

    expect(content).toBe('hello\nworld\n')
    expect(read).toMatchObject({ content: 'hello\nworld\n' })
    expect(grep).toEqual({
      matches: [{ path: 'src/a.txt', line: 2, text: 'world' }]
    })
  })

  test('apply patch parses codex/opencode hunks and computes replacements', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'patch-plugin-'))
    await mkdir(path.join(root, 'src'), { recursive: true })
    await mkdir(path.join(root, 'old'), { recursive: true })
    await writeFile(
      path.join(root, 'src/file.txt'),
      'alpha\nsame\nold one\nsame\nmiddle\nlast old\n'
    )
    await writeFile(path.join(root, 'src/bom.txt'), '\uFEFFsmart - quote\n')
    await writeFile(path.join(root, 'old/name.txt'), 'from\n')

    const result = await applyPatch({
      root,
      patch: `
*** Begin Patch
*** Update File: src/file.txt
@@
 same
-old one
+new one
@@
 middle
-last old
+last new
*** End of File
*** Add File: src/added.txt
+created
*** Update File: src/bom.txt
@@
-smart - quote
+plain
*** Update File: old/name.txt
*** Move to: renamed/name.txt
@@
-from
+to
*** End Patch
`
    })

    expect(result.changedFiles).toEqual([
      'src/file.txt',
      'src/added.txt',
      'src/bom.txt',
      'renamed/name.txt'
    ])
    expect(await readFile(path.join(root, 'src/file.txt'), 'utf8')).toBe(
      'alpha\nsame\nnew one\nsame\nmiddle\nlast new\n'
    )
    expect(await readFile(path.join(root, 'src/added.txt'), 'utf8')).toBe(
      'created\n'
    )
    expect(await readFile(path.join(root, 'src/bom.txt'), 'utf8')).toBe(
      '\uFEFFplain\n'
    )
    expect(await readFile(path.join(root, 'renamed/name.txt'), 'utf8')).toBe(
      'to\n'
    )
    await expect(
      readFile(path.join(root, 'old/name.txt'), 'utf8')
    ).rejects.toThrow()
  })

  test('apply patch verifies all hunks before writing files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'patch-plugin-'))

    await expect(
      applyPatch({
        root,
        patch: `
*** Begin Patch
*** Add File: created.txt
+created
*** Update File: missing.txt
@@
-missing
+present
*** End Patch
`
      })
    ).rejects.toThrow('Failed to read file: missing.txt')
    await expect(
      readFile(path.join(root, 'created.txt'), 'utf8')
    ).rejects.toThrow()
  })

  test('shell tool runs command and returns process result', async () => {
    const configured = withShellTool<Context>()(options())
    const output = await configured.tools!.shell!.execute!(
      { cmd: process.execPath, args: ['-e', "process.stdout.write('ok')"] },
      { toolCallId: 'shell', messages: [] }
    )

    expect(output).toMatchObject({ stdout: 'ok', exitCode: 0 })
  })

  test('lsp tool starts server, syncs file, returns locations, and reports diagnostics', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lsp-plugin-'))
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'a.ts'), 'const answer = 42\n')
    const serverPath = path.join(root, 'fake-lsp.js')
    await writeFile(serverPath, fakeLspServer())

    const client = createNodeLspClient({
      cwd: root,
      requestTimeoutMs: 1_000,
      diagnosticsTimeoutMs: 500,
      servers: [
        {
          id: 'fake',
          command: [process.execPath, serverPath],
          extensions: ['.ts'],
          languageId: 'typescript'
        }
      ]
    })
    const configured = withLspTool<Context>({ cwd: root, client })(options())

    try {
      const output = await configured.tools!.lsp!.execute!(
        {
          operation: 'goToDefinition',
          filePath: 'src/a.ts',
          line: 1,
          character: 7
        },
        { toolCallId: 'lsp', messages: [] }
      )
      const diagnostics = await diagnosticsAfterEdit(
        client,
        path.join(root, 'src', 'a.ts')
      )

      expect(output).toMatchObject({
        title: 'goToDefinition src/a.ts:1:7',
        result: [
          {
            uri: pathToFileUrl(path.join(root, 'src', 'a.ts')),
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 12 }
            }
          }
        ]
      })
      expect(diagnostics).toMatchObject([
        {
          severity: 2,
          message: 'fake diagnostic'
        }
      ])
    } finally {
      await client.close?.()
    }
  })

  test('prompt plugin transforms prepared messages', async () => {
    const configured = withSystemPrompt<Context>('system text')(options())
    const prepared = (await configured.hooks.onTurnPrepared({
      context: { id: 'ctx' },
      state: {
        runId: 'run',
        revision: 0,
        status: { type: 'running', phase: 'turn_prepared' },
        context: { id: 'ctx' },
        turns: [],
        updatedAt: new Date(0).toISOString()
      },
      runId: 'run',
      createdAt: new Date(0).toISOString(),
      turn: {
        turnId: 'turn',
        turn: 0,
        toolCalls: { pending: [], inFlight: [], completed: [] }
      }
    })) as { value?: { messages?: unknown[] } }

    expect(prepared?.value?.messages?.[0]).toEqual({
      role: 'system',
      content: 'system text'
    })
  })

  test('opencode skills add catalog and explicit skill tool', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'opencode-skills-'))
    const skillDir = path.join(root, 'skills', 'review')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: review',
        'description: Review code for bugs.',
        '---',
        'Inspect changed files and report findings first.'
      ].join('\n')
    )
    await writeFile(path.join(skillDir, 'notes.md'), 'extra context')

    const configured = withOpenCodeSkills<Context>({
      cwd: root,
      dirs: [root],
      includeGlobal: false,
      includeProjectAncestors: false
    })(options())
    const prepared = (await configured.hooks.onTurnPrepared({
      context: { id: 'ctx' },
      state: {
        runId: 'run',
        revision: 0,
        status: { type: 'running', phase: 'turn_prepared' },
        context: { id: 'ctx' },
        turns: [],
        updatedAt: new Date(0).toISOString()
      },
      runId: 'run',
      createdAt: new Date(0).toISOString(),
      turn: {
        turnId: 'turn',
        turn: 0,
        toolCalls: { pending: [], inFlight: [], completed: [] }
      }
    })) as { value?: { messages?: Array<{ content?: string }> } }
    const output = await configured.tools!.skill!.execute!(
      { name: 'review' },
      {
        toolCallId: 'skill',
        messages: [],
        experimental_context: { id: 'ctx' }
      }
    )

    expect(prepared.value?.messages?.[0]?.content).toContain(
      '<available_skills>'
    )
    expect(output).toMatchObject({
      name: 'review',
      description: 'Review code for bugs.',
      files: ['notes.md']
    })
    expect((output as { content: string }).content).toContain(
      'Inspect changed files'
    )
  })

  test('codex skills render catalog and inject mentioned skill content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-skills-'))
    const skillDir = path.join(root, 'review')
    await mkdir(path.join(skillDir, 'agents'), { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: review',
        'description: Review code for regressions.',
        '---',
        'Find correctness bugs before style issues.'
      ].join('\n')
    )
    await writeFile(
      path.join(skillDir, 'agents', 'openai.yaml'),
      ['dependencies:', '  env:', '    - REVIEW_TOKEN'].join('\n')
    )

    const configured = withCodexSkills<Context>({
      roots: [{ path: root, scope: 'repo' }],
      resolveEnv: ({ name }) =>
        name === 'REVIEW_TOKEN' ? 'present' : undefined
    })({
      ...options(),
      hooks: {
        onTurnPrepared: () => ({
          value: {
            model: 'test/model',
            messages: [{ role: 'user', content: 'Use $review on this diff.' }]
          }
        })
      }
    })
    const prepared = (await configured.hooks.onTurnPrepared({
      context: { id: 'ctx' },
      state: {
        runId: 'run',
        revision: 0,
        status: { type: 'running', phase: 'turn_prepared' },
        context: { id: 'ctx' },
        turns: [],
        updatedAt: new Date(0).toISOString()
      },
      runId: 'run',
      createdAt: new Date(0).toISOString(),
      turn: {
        turnId: 'turn',
        turn: 0,
        toolCalls: { pending: [], inFlight: [], completed: [] }
      }
    })) as { value?: { messages?: Array<{ content?: string }> } }

    expect(prepared.value?.messages?.[0]?.content).toContain('## Skills')
    expect(prepared.value?.messages?.[1]?.content).toContain(
      '<skill_content name="review"'
    )
  })

  test('codex skill mentions resolve only unambiguous names', () => {
    const selected = collectSkillMentions({
      value: {
        model: 'test/model',
        messages: [{ role: 'user', content: '$review' }]
      },
      skills: [
        codexSkill({ filePath: '/a/SKILL.md' }),
        codexSkill({ filePath: '/b/SKILL.md' })
      ]
    })

    expect(selected).toEqual([])
  })

  test('opencode compaction keeps tail and stores anchored summary metadata', async () => {
    let saved:
      | {
          summary: string
          tokensBefore: number
          tokensAfter: number
          readFiles: string[]
        }
      | undefined
    const configured = withOpenCodeCompaction<Context>({
      maxTokens: 20,
      preserveRecentTokens: 30,
      tailTurns: 1,
      store: {
        latest: () => ({
          summary: 'previous',
          tokensBefore: 1,
          tokensAfter: 1,
          trigger: 'auto',
          createdAt: new Date(0).toISOString(),
          readFiles: [],
          modifiedFiles: []
        }),
        save: (_, entry) => {
          saved = entry
        }
      },
      summarize: ({ previousSummary, messages, prompt }) =>
        `summary:${previousSummary}:${messages.length}:${prompt.includes('<previous-summary>')}`
    })({
      ...options(),
      hooks: {
        onTurnPrepared: () => ({
          value: {
            model: 'test/model',
            messages: [
              { role: 'user', content: 'read old file' },
              {
                role: 'assistant',
                content:
                  '{"toolName":"read_file","input":{"path":"old.ts"},"output":"result"}'
              },
              { role: 'assistant', content: 'old answer' },
              { role: 'user', content: 'latest request' }
            ]
          }
        })
      }
    })

    const prepared = await runPrepared(configured)

    expect(prepared.value?.messages?.[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('summary:previous:3:true')
    })
    expect(prepared.value?.messages?.at(-1)).toEqual({
      role: 'user',
      content: 'latest request'
    })
    expect(saved?.readFiles).toEqual(['old.ts'])
    expect(saved?.tokensBefore).toBeGreaterThan(saved?.tokensAfter ?? 0)
  })

  test('codex compaction runs hooks and replaces history with recent users plus summary', async () => {
    const hooks: string[] = []
    const configured = withCodexCompaction<Context>({
      maxTokens: 20,
      preserveUserTokens: 8,
      initialContext: () => [{ role: 'system', content: 'initial context' }],
      preCompact: () => {
        hooks.push('pre')
        return { continue: true }
      },
      postCompact: () => {
        hooks.push('post')
        return { continue: true }
      },
      summarize: ({ prompt }) => `codex summary:${prompt.includes('Summarize')}`
    })({
      ...options(),
      hooks: {
        onTurnPrepared: () => ({
          value: {
            model: 'test/model',
            messages: [
              { role: 'user', content: 'first user message' },
              { role: 'assistant', content: 'assistant answer' },
              { role: 'user', content: 'second user message' }
            ]
          }
        })
      }
    })

    const prepared = await runPrepared(configured)

    expect(hooks).toEqual(['pre', 'post'])
    expect(prepared.value?.messages?.[0]).toEqual({
      role: 'system',
      content: 'initial context'
    })
    expect(prepared.value?.messages?.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('codex summary:true')
    })
  })

  test('codex pre compact hook can pause before replacing history', async () => {
    const configured = withCodexCompaction<Context>({
      maxTokens: 20,
      preCompact: () => ({ continue: false, stopReason: 'policy stopped' }),
      summarize: () => {
        throw new Error('unreachable')
      }
    })({
      ...options(),
      hooks: {
        onTurnPrepared: () => ({
          value: {
            model: 'test/model',
            messages: [
              { role: 'user', content: 'message one' },
              { role: 'assistant', content: 'message two' },
              { role: 'user', content: 'message three' }
            ]
          }
        })
      }
    })

    const prepared = await runPrepared(configured)

    expect(prepared.control).toEqual({
      type: 'pause',
      reason: 'policy stopped'
    })
  })

  test('goal tools use codex names, schema, and completion response', async () => {
    const store = createMemoryGoalStore<Context>({
      threadId: 'thread',
      id: () => 'goal-1',
      now: () => new Date(0).toISOString()
    })
    const configured = withGoalTools<Context>({ store })(options())

    expect(configured.tools!.complete_goal).toBeUndefined()
    const created = await configured.tools!.create_goal!.execute!(
      { objective: 'Ship goal support', token_budget: 100 },
      {
        toolCallId: 'create',
        messages: [],
        experimental_context: { id: 'ctx' }
      }
    )
    await expect(async () => {
      await configured.tools!.create_goal!.execute!(
        { objective: 'duplicate' },
        {
          toolCallId: 'create-again',
          messages: [],
          experimental_context: { id: 'ctx' }
        }
      )
    }).toThrow('already has a goal')
    await expect(async () => {
      await configured.tools!.update_goal!.execute!(
        { status: 'paused' },
        {
          toolCallId: 'bad-update',
          messages: [],
          experimental_context: { id: 'ctx' }
        }
      )
    }).toThrow('can only mark')
    await store.accountUsage?.({
      goalId: 'goal-1',
      tokens: 40,
      seconds: 2,
      context: { id: 'ctx' }
    })
    const completed = await configured.tools!.update_goal!.execute!(
      { status: 'complete' },
      {
        toolCallId: 'update',
        messages: [],
        experimental_context: { id: 'ctx' }
      }
    )

    expect(created).toMatchObject({
      goal: {
        goalId: 'goal-1',
        objective: 'Ship goal support',
        status: 'active',
        tokenBudget: 100
      },
      remainingTokens: 100,
      completionBudgetReport: null
    })
    expect(completed).toMatchObject({
      goal: { status: 'complete', tokensUsed: 40 },
      remainingTokens: 60,
      completionBudgetReport:
        'Goal achieved. Report final budget usage to the user: tokens used: 40 of 100; time used: 2 seconds.'
    })
  })

  test('goal runtime injects active goal context and accounts model usage', async () => {
    const store = createMemoryGoalStore<Context>({
      threadId: 'thread',
      id: () => 'goal-1',
      now: () => new Date(0).toISOString()
    })
    await store.create({
      objective: 'Finish the benchmark',
      tokenBudget: 50,
      context: { id: 'ctx' }
    })
    const configured = withGoalTools<Context>({ store })(options())

    await configured.hooks.onTurnStarted?.(turnStartedArgs())
    const prepared = await runPrepared(configured)
    await configured.hooks.onModelCompleted?.({
      ...modelCompletedArgs(),
      result: {
        ...modelCompletedArgs().result,
        totalUsage: {
          inputTokens: 30,
          outputTokens: 25,
          totalTokens: 55,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined
          }
        }
      }
    })
    const goal = await store.get({ id: 'ctx' })

    expect(prepared.value?.messages?.[0]?.content).toContain('<goal_context>')
    expect(prepared.value?.messages?.[0]?.content).toContain(
      'Finish the benchmark'
    )
    expect(goal).toMatchObject({
      status: 'budget_limited',
      tokensUsed: 55
    })
  })

  test('tool permission can deny execution before next middleware', async () => {
    const configured = withToolPermission<Context>(() => ({
      allow: false,
      reason: 'blocked'
    }))(options())
    const result = await configured.middleware?.callTool?.[0]?.({
      input: toolInput({ id: 'ctx' }),
      next: async () => {
        throw new Error('unreachable')
      }
    })

    expect(result).toMatchObject({
      output: { denied: true, reason: 'blocked' }
    })
  })

  test('tool concurrency serializes same key', async () => {
    const events: string[] = []
    const configured = withToolConcurrency<Context>()(options())
    const middleware = configured.middleware?.callTool?.[0]
    await Promise.all([
      middleware?.({
        input: toolInput({ id: 'ctx' }),
        next: async () => {
          events.push('a:start')
          await new Promise(resolve => setTimeout(resolve, 10))
          events.push('a:end')
          return response('a')
        }
      }),
      middleware?.({
        input: toolInput({ id: 'ctx' }),
        next: async () => {
          events.push('b:start')
          events.push('b:end')
          return response('b')
        }
      })
    ])

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  test('model retry re-runs model middleware', async () => {
    let calls = 0
    const configured = withModelRetry<Context>({ attempts: 2 })(options())
    const result = await configured.middleware?.callModel?.[0]?.({
      input: {
        context: { id: 'ctx' },
        state: {} as never,
        runId: 'run',
        createdAt: new Date(0).toISOString(),
        turn: {} as never,
        args: { model: 'test/model', toolNames: [], messages: [] }
      },
      next: async input => {
        calls++
        if (calls === 1) throw new Error('retry')
        return {
          args: input.args,
          duration: 1,
          pendingToolCalls: [],
          rawResult: {} as never,
          result: {
            response: {
              id: 'r',
              modelId: 'm',
              timestamp: new Date(),
              messages: []
            },
            totalUsage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              inputTokenDetails: {
                noCacheTokens: undefined,
                cacheReadTokens: undefined,
                cacheWriteTokens: undefined
              },
              outputTokenDetails: {
                textTokens: undefined,
                reasoningTokens: undefined
              }
            }
          }
        }
      }
    })

    expect(calls).toBe(2)
    expect((result as { duration?: number } | undefined)?.duration).toBe(1)
  })
})

function toolInput(context: Context) {
  return {
    context,
    messages: [],
    toolCall: { toolCallId: 'call', toolName: 'tool', input: {} },
    tools: {}
  }
}

function response(value: string) {
  return {
    toolCallId: 'call',
    toolName: 'tool',
    input: {},
    output: value
  }
}

async function runPrepared(configured: RunAgentOptions<Context>) {
  return (await configured.hooks.onTurnPrepared({
    context: { id: 'ctx' },
    state: {
      runId: 'run',
      revision: 0,
      status: { type: 'running', phase: 'turn_prepared' },
      context: { id: 'ctx' },
      turns: [],
      updatedAt: new Date(0).toISOString()
    },
    runId: 'run',
    createdAt: new Date(0).toISOString(),
    turn: {
      turnId: 'turn',
      turn: 0,
      toolCalls: { pending: [], inFlight: [], completed: [] }
    }
  })) as {
    value?: { messages?: Array<{ role: string; content: string }> }
    control?: unknown
  }
}

function turnStartedArgs(): AgentTurnStartedArgs<Context> {
  return {
    context: { id: 'ctx' },
    state: {
      runId: 'run',
      revision: 0,
      status: { type: 'running', phase: 'turn_started' },
      context: { id: 'ctx' },
      turns: [],
      updatedAt: new Date(0).toISOString()
    },
    runId: 'run',
    createdAt: new Date(0).toISOString(),
    turn: {
      turnId: 'turn',
      turn: 0,
      toolCalls: { pending: [], inFlight: [], completed: [] }
    }
  }
}

function modelCompletedArgs(): AgentModelCompletedArgs<Context> {
  return {
    context: { id: 'ctx' },
    state: {
      runId: 'run',
      revision: 0,
      status: { type: 'running', phase: 'model_completed' },
      context: { id: 'ctx' },
      turns: [],
      updatedAt: new Date(0).toISOString()
    },
    runId: 'run',
    args: { model: 'test/model', toolNames: [], messages: [] },
    createdAt: new Date(0).toISOString(),
    duration: 1,
    rawResult: {} as never,
    result: {
      response: {
        id: 'r',
        modelId: 'm',
        timestamp: new Date(),
        messages: []
      },
      totalUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined
        }
      }
    },
    turn: {
      turnId: 'turn',
      turn: 0,
      toolCalls: { pending: [], inFlight: [], completed: [] }
    }
  }
}

function codexSkill(params: { filePath: string }) {
  return {
    name: 'review',
    description: 'Review code.',
    content: 'Review content.',
    filePath: params.filePath,
    scope: 'repo' as const,
    policy: { allowImplicitInvocation: true, products: [] },
    dependencies: { env: [], tools: [] }
  }
}

function pathToFileUrl(file: string) {
  return pathToFileURL(file).href
}

function fakeLspServer() {
  return `
let buffer = Buffer.alloc(0)

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  read()
})

function read() {
  while (true) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n')
    if (headerEnd === -1) return

    const header = buffer.subarray(0, headerEnd).toString('utf8')
    const lengthLine = header
      .split('\\r\\n')
      .find(line => line.toLowerCase().startsWith('content-length:'))
    const length = Number(lengthLine.slice(lengthLine.indexOf(':') + 1).trim())
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + length
    if (buffer.length < bodyEnd) return

    const message = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString('utf8'))
    buffer = buffer.subarray(bodyEnd)
    handle(message)
  }
}

function handle(message) {
  if (message.method === 'initialize') {
    respond(message.id, {
      capabilities: {
        textDocumentSync: 2,
        definitionProvider: true,
        diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false }
      }
    })
    return
  }

  if (message.method === 'shutdown') {
    respond(message.id, null)
    return
  }

  if (message.method === 'textDocument/didOpen' || message.method === 'textDocument/didChange') {
    const uri = message.params.textDocument.uri
    notify('textDocument/publishDiagnostics', {
      uri,
      diagnostics: [
        {
          severity: 2,
          message: 'fake diagnostic',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 }
          }
        }
      ]
    })
    return
  }

  if (message.method === 'textDocument/definition') {
    respond(message.id, [
      {
        uri: message.params.textDocument.uri,
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 12 }
        }
      }
    ])
    return
  }
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params })
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\\r\\n\\r\\n' + body)
}
`
}
