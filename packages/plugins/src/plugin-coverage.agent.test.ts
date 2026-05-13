import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'
import type {
  AgentCallToolArgs,
  AgentPhaseEvent,
  AgentRunState,
  AgentToolCallResponse,
  AgentTurnCompletedArgs,
  AgentTurnPreparedArgs,
  RunAgentOptions,
  Turn
} from '@nanoagent/kernel'
import {
  createMcpTools,
  evaluatePermissionRules,
  formatSkillInvocation,
  flushRawStdout,
  isStdoutTakenOver,
  loadSkills,
  mcpToolName,
  restoreStdout,
  takeOverStdout,
  withCompaction,
  withDiscoveredSkills,
  withEventSink,
  withFileMutationQueue,
  withFilesystemTools,
  withMemory,
  withMcpTools,
  withPermissionRules,
  withPromptMessages,
  withRevertTools,
  withSandboxPolicy,
  withSessionStore,
  withSkills,
  withSlashCommands,
  withTaskTool,
  withToolResultMapper,
  withTranscriptRecorder,
  withVisibleTools,
  writeRawStdout
} from './index.js'

type Context = {
  id: string
  sessionId: string
}

type CallToolMiddleware = NonNullable<
  NonNullable<RunAgentOptions<Context>['middleware']>['callTool']
>[number]

const context: Context = { id: 'ctx', sessionId: 'session-1' }

function baseOptions(): RunAgentOptions<Context> {
  return {
    state: { context },
    maxTurns: 1,
    hooks: {
      onTurnPrepared: () => ({
        value: { model: 'test/model', messages: [] }
      })
    }
  }
}

function makeState(events: readonly Turn[] = []): AgentRunState<Context> {
  return {
    runId: 'run-1',
    revision: 0,
    status: { type: 'running', phase: 'turn_completed' },
    context,
    turns: [...events],
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function makeTurn(): Turn {
  return {
    turnId: 'turn-1',
    turn: 1,
    toolCalls: { pending: [], inFlight: [], completed: [] }
  }
}

function turnPreparedArgs(): AgentTurnPreparedArgs<Context> {
  return {
    context,
    state: makeState(),
    runId: 'run-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    turn: makeTurn()
  }
}

async function withTempDir<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'nano-plugin-coverage-'))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function invokeToolCall(params: {
  middleware?: readonly CallToolMiddleware[]
  toolName: string
  input: unknown
  next: (input: AgentCallToolArgs<Context>) => Promise<AgentToolCallResponse>
}) {
  const stack = [...(params.middleware ?? [])]
  const toolCall = {
    toolCallId: `${params.toolName}-1`,
    toolName: params.toolName,
    input: params.input
  }
  const dispatch = (
    index: number,
    input: AgentCallToolArgs<Context>
  ): Promise<AgentToolCallResponse> => {
    const current = stack[index]
    if (!current) return params.next(input)
    return Promise.resolve(
      current({
        input,
        next: nextInput => dispatch(index + 1, nextInput)
      }) as AgentToolCallResponse | PromiseLike<AgentToolCallResponse>
    )
  }

  return dispatch(0, { context, messages: [], toolCall, tools: {} })
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('plugin coverage combinations', () => {
  test('generic prompt and discovered skill plugins compose messages, memory, skills, slash output, and compaction', async () => {
    await withTempDir(async root => {
      const skillDir = path.join(root, 'alpha')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: alpha',
          'description: Alpha skill.',
          '---',
          'Use alpha.'
        ].join('\n')
      )

      const loaded = await loadSkills([root])
      expect(loaded.diagnostics).toEqual([])
      expect(loaded.skills.map(skill => skill.name)).toEqual(['alpha'])
      expect(formatSkillInvocation(loaded.skills[0]!, 'Extra')).toContain(
        '<skill name="alpha"'
      )

      const configured = withCompaction<Context>({
        shouldCompact: () => true,
        compact: () => [{ role: 'system', content: 'compact summary' }]
      })(
        withSlashCommands<Context>(() => [
          { role: 'user', content: 'expanded slash' }
        ])(
          withSkills<Context>(() => [{ name: 'beta', body: 'Use beta.' }])(
            withMemory<Context>(() => ['remember one'])(
              withPromptMessages<Context>(() => [
                { role: 'user', content: 'loaded prompt' }
              ])(withDiscoveredSkills<Context>({ dirs: [root] })(baseOptions()))
            )
          )
        )
      )

      const prepared = (await configured.hooks.onTurnPrepared(
        turnPreparedArgs()
      )) as { value?: { messages?: unknown[] } }
      expect(prepared.value?.messages).toEqual([
        { role: 'system', content: 'compact summary' }
      ])
    })
  })

  test('filesystem plugin executes full rooted read/write/edit/list/grep bundle', async () => {
    await withTempDir(async root => {
      await mkdir(path.join(root, 'node_modules'), { recursive: true })
      await writeFile(path.join(root, 'node_modules', 'skip.txt'), 'needle')

      const configured = withFilesystemTools<Context>({ root })(baseOptions())
      const tools = configured.tools!

      await expect(
        tools.write_file!.execute!(
          { path: 'src/example.txt', content: 'Alpha\nBeta\n' },
          { toolCallId: 'write', messages: [], experimental_context: context }
        )
      ).resolves.toEqual({ path: 'src/example.txt', bytes: 11 })

      await expect(
        tools.read_file!.execute!(
          { path: 'src/example.txt', maxBytes: 5 },
          { toolCallId: 'read', messages: [], experimental_context: context }
        )
      ).resolves.toEqual({ path: 'src/example.txt', content: 'Alpha' })

      const edit = await tools.edit_file!.execute!(
        {
          path: 'src/example.txt',
          edits: [{ oldText: 'Beta', newText: 'Gamma' }]
        },
        { toolCallId: 'edit', messages: [], experimental_context: context }
      )
      expect(edit).toMatchObject({
        path: 'src/example.txt',
        replacements: 1
      })
      await expect(
        readFile(path.join(root, 'src/example.txt'), 'utf8')
      ).resolves.toBe('Alpha\nGamma\n')

      await expect(
        tools.list_files!.execute!(
          { path: '.', recursive: true, maxEntries: 10 },
          { toolCallId: 'list', messages: [], experimental_context: context }
        )
      ).resolves.toEqual({
        root: '.',
        files: ['src/', 'src/example.txt']
      })

      await expect(
        tools.grep_files!.execute!(
          { pattern: 'gamma', caseSensitive: false },
          { toolCallId: 'grep', messages: [], experimental_context: context }
        )
      ).resolves.toEqual({
        matches: [{ path: 'src/example.txt', line: 2, text: 'Gamma' }]
      })

      await expect(
        tools.read_file!.execute!(
          { path: '../escape.txt' },
          { toolCallId: 'escape', messages: [], experimental_context: context }
        )
      ).rejects.toThrow('Path escapes workspace root')
    })
  })

  test('mcp plugin namespaces remote tools and exposes resource reads', async () => {
    const calls: unknown[] = []
    const client = {
      listTools: () => [
        {
          server: 'local server',
          name: 'search.files',
          description: 'Search files.',
          inputSchema: {
            type: 'object' as const,
            properties: { query: { type: 'string' as const } },
            required: ['query']
          }
        }
      ],
      callTool: (args: unknown) => {
        calls.push(args)
        return { ok: true }
      },
      listResources: () => [{ uri: 'file://a', name: 'A' }],
      readResource: (uri: string) => ({ uri, text: 'resource' })
    }

    expect(mcpToolName('local server', 'search.files')).toBe(
      'mcp__local_server__search_files'
    )
    const directTools = await createMcpTools<Context>(client)
    expect(Object.keys(directTools).sort()).toEqual([
      'mcp__local_server__search_files',
      'mcp_read_resource'
    ])

    const configured = (await withMcpTools<Context>(client))(baseOptions())
    await expect(
      Promise.resolve(
        configured.tools!.mcp__local_server__search_files!.execute!(
          { query: 'alpha' },
          { toolCallId: 'mcp', messages: [], experimental_context: context }
        )
      )
    ).resolves.toEqual({ ok: true })
    expect(calls).toEqual([
      {
        server: 'local server',
        name: 'search.files',
        input: { query: 'alpha' }
      }
    ])

    await expect(
      Promise.resolve(
        configured.tools!.mcp_read_resource!.execute!(
          { uri: 'file://a' },
          {
            toolCallId: 'resource',
            messages: [],
            experimental_context: context
          }
        )
      )
    ).resolves.toEqual({ uri: 'file://a', text: 'resource' })
  })

  test('task and revert plugins delegate to caller-owned stores with context', async () => {
    const taskCalls: unknown[] = []
    const taskConfigured = withTaskTool<Context>({
      agents: () => [{ name: 'worker', kind: 'code' }],
      run: async args => {
        taskCalls.push(args)
        return {
          taskId: args.taskId ?? 'task-1',
          output: `done:${args.prompt}`,
          metadata: { agent: args.agent.name }
        }
      }
    })(baseOptions())

    await expect(
      taskConfigured.tools!.task!.execute!(
        {
          description: 'inspect',
          prompt: 'check plugins',
          subagent_type: 'worker',
          task_id: 'existing'
        },
        { toolCallId: 'task', messages: [], experimental_context: context }
      )
    ).resolves.toEqual({
      task_id: 'existing',
      output:
        'task_id: existing\n\n<task_result>\ndone:check plugins\n</task_result>',
      metadata: { agent: 'worker' }
    })
    expect(taskCalls).toEqual([
      {
        description: 'inspect',
        prompt: 'check plugins',
        agent: { name: 'worker', kind: 'code' },
        taskId: 'existing',
        context
      }
    ])

    await expect(
      taskConfigured.tools!.task!.execute!(
        { description: 'bad', prompt: 'x', subagent_type: 'missing' },
        { toolCallId: 'task', messages: [], experimental_context: context }
      )
    ).rejects.toThrow('Unknown agent type: missing')

    const revertCalls: unknown[] = []
    const revertConfigured = withRevertTools<Context>({
      store: {
        revert: args => {
          revertCalls.push(['revert', args])
          return { reverted: args.messageId }
        },
        unrevert: args => {
          revertCalls.push(['unrevert', args])
          return { unreverted: args.sessionId }
        }
      }
    })(baseOptions())

    await expect(
      Promise.resolve(
        revertConfigured.tools!.revert_session!.execute!(
          { sessionId: 's1', messageId: 'm1', partId: 'p1' },
          { toolCallId: 'revert', messages: [], experimental_context: context }
        )
      )
    ).resolves.toEqual({ reverted: 'm1' })
    await expect(
      Promise.resolve(
        revertConfigured.tools!.unrevert_session!.execute!(
          { sessionId: 's1' },
          {
            toolCallId: 'unrevert',
            messages: [],
            experimental_context: context
          }
        )
      )
    ).resolves.toEqual({ unreverted: 's1' })
    expect(revertCalls).toEqual([
      ['revert', { sessionId: 's1', messageId: 'm1', partId: 'p1', context }],
      ['unrevert', { sessionId: 's1', context }]
    ])
  })

  test('session store, event sink, and transcript recorder compose with existing hooks', async () => {
    const calls: unknown[] = []
    const turn = makeTurn()
    const state = makeState([turn])
    const event: AgentPhaseEvent = {
      type: 'turn_completed',
      runId: 'run-1',
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      duration: 3,
      turn
    }

    const configured = withTranscriptRecorder<Context>(args => {
      calls.push(['transcript', args])
    })(
      withEventSink<Context>(event => {
        calls.push(['event', event.type])
      })(
        withSessionStore<Context>({
          save: args => {
            calls.push(['store', args.events.map(event => event.type)])
          }
        })({
          ...baseOptions(),
          saveState: args => {
            calls.push(['base-save', args.events.length])
          },
          hooks: {
            ...baseOptions().hooks,
            onTurnCompleted: () => {
              calls.push(['base-turn-completed'])
            }
          }
        })
      )
    )

    await configured.saveState!({ state, events: [event] })
    await configured.hooks.onTurnCompleted!({
      context,
      state,
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      duration: 3,
      turn
    } satisfies AgentTurnCompletedArgs<Context>)

    expect(calls).toEqual([
      ['base-save', 1],
      ['store', ['turn_completed']],
      ['event', 'turn_completed'],
      ['base-turn-completed'],
      [
        'transcript',
        {
          context,
          state,
          turnId: 'turn-1'
        }
      ]
    ])
  })

  test('permission, visibility, result mapping, sandbox, and mutation queue compose as tool runtime middleware', async () => {
    const visible = withVisibleTools<Context>(({ tools }) =>
      Object.keys(tools).filter(name => name !== 'hidden')
    )({
      ...baseOptions(),
      tools: {
        visible: { inputSchema: {} as never, execute: () => 'ok' },
        hidden: { inputSchema: {} as never, execute: () => 'no' }
      }
    })
    expect(Object.keys(visible.tools ?? {})).toEqual(['visible'])

    const calls: unknown[] = []
    const configured = withToolResultMapper<Context>(({ response }) => {
      if ('error' in response && response.error !== undefined) return response
      return {
        toolCallId: response.toolCallId,
        toolName: response.toolName,
        input: response.input,
        output: { mapped: response.output }
      }
    })(
      withSandboxPolicy<Context>({
        policy: ({ toolName }) => ({ mode: 'workspace_write', toolName }),
        run: args => calls.push(['sandbox', args.toolName, args.policy.mode]),
        retryWithoutSandbox: args => {
          calls.push(['retry?', args.toolName])
          return true
        }
      })(
        withPermissionRules<Context>({
          rules: [],
          request: request => {
            calls.push(['permission', request.permission, request.patterns])
            return { action: 'allow', remember: true }
          }
        })(withFileMutationQueue<Context>()(baseOptions()))
      )
    )

    let attempts = 0
    const first = await invokeToolCall({
      middleware: configured.middleware!.callTool,
      toolName: 'write_file',
      input: { path: 'same.txt' },
      next: async input => {
        attempts += 1
        if (attempts === 1) {
          return { ...input.toolCall, error: new Error('sandbox failed') }
        }
        return { ...input.toolCall, output: 'written' }
      }
    })
    expect(first).toMatchObject({
      toolCallId: 'write_file-1',
      toolName: 'write_file',
      output: { mapped: 'written' }
    })

    const second = await invokeToolCall({
      middleware: configured.middleware!.callTool,
      toolName: 'write_file',
      input: { path: 'same.txt' },
      next: async input => ({ ...input.toolCall, output: 'again' })
    })
    expect(second).toMatchObject({ output: { mapped: 'again' } })
    expect(calls).toEqual([
      ['permission', 'write_file', ['same.txt']],
      ['sandbox', 'write_file', 'workspace_write'],
      ['retry?', 'write_file'],
      ['sandbox', 'write_file', 'workspace_write']
    ])

    const serialized: string[] = []
    await Promise.all([
      invokeToolCall({
        middleware: configured.middleware!.callTool,
        toolName: 'write_file',
        input: { path: 'serial.txt' },
        next: async input => {
          serialized.push(`${input.toolCall.toolCallId}:start`)
          await delay(10)
          serialized.push(`${input.toolCall.toolCallId}:end`)
          return { ...input.toolCall, output: 'a' }
        }
      }),
      invokeToolCall({
        middleware: configured.middleware!.callTool,
        toolName: 'write_file',
        input: { path: 'serial.txt' },
        next: async input => {
          serialized.push(`${input.toolCall.toolCallId}:start`)
          await delay(1)
          serialized.push(`${input.toolCall.toolCallId}:end`)
          return { ...input.toolCall, output: 'b' }
        }
      })
    ])
    expect(serialized).toEqual([
      'write_file-1:start',
      'write_file-1:end',
      'write_file-1:start',
      'write_file-1:end'
    ])
  })

  test('permission rules use last match, wildcard patterns, request decisions, and remembered grants', async () => {
    expect(
      evaluatePermissionRules({
        rules: [
          { permission: '*', pattern: '*', action: 'deny' },
          { permission: 'shell', pattern: 'npm', action: 'allow' }
        ],
        permission: 'shell',
        patterns: ['npm']
      })
    ).toBe('allow')

    let requests = 0
    const configured = withPermissionRules<Context>({
      rules: [
        { permission: 'read_file', pattern: 'private/*', action: 'deny' }
      ],
      request: () => {
        requests += 1
        return { action: 'allow', remember: true }
      }
    })(baseOptions())

    await expect(
      invokeToolCall({
        middleware: configured.middleware!.callTool,
        toolName: 'read_file',
        input: { path: 'private/key.txt' },
        next: async input => ({ ...input.toolCall, output: 'secret' })
      })
    ).resolves.toMatchObject({
      output: { denied: true, reason: 'Denied by permission rule.' }
    })

    await invokeToolCall({
      middleware: configured.middleware!.callTool,
      toolName: 'read_file',
      input: { path: 'public/a.txt' },
      next: async input => ({ ...input.toolCall, output: 'a' })
    })
    await invokeToolCall({
      middleware: configured.middleware!.callTool,
      toolName: 'read_file',
      input: { path: 'public/a.txt' },
      next: async input => ({ ...input.toolCall, output: 'a' })
    })
    expect(requests).toBe(1)
  })

  test('output guard redirects ordinary stdout and preserves raw stdout writes', async () => {
    const originalStdout = process.stdout.write
    const originalStderr = process.stderr.write
    const stdout: string[] = []
    const stderr: string[] = []

    process.stdout.write = ((chunk, encodingOrCallback, callback) => {
      stdout.push(String(chunk))
      const done =
        typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
      done?.()
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk, encodingOrCallback, callback) => {
      stderr.push(String(chunk))
      const done =
        typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
      done?.()
      return true
    }) as typeof process.stderr.write

    try {
      takeOverStdout()
      expect(isStdoutTakenOver()).toBe(true)
      process.stdout.write('guarded')
      writeRawStdout('raw')
      await flushRawStdout()
      restoreStdout()
      process.stdout.write('normal')
    } finally {
      restoreStdout()
      process.stdout.write = originalStdout
      process.stderr.write = originalStderr
    }

    expect(stdout.filter(Boolean)).toEqual(['raw', 'normal'])
    expect(stderr).toEqual(['guarded'])
    expect(isStdoutTakenOver()).toBe(false)
  })
})
