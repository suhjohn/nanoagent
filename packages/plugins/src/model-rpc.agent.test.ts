import { PassThrough } from 'node:stream'
import { describe, expect, test } from 'bun:test'
import type {
  AgentCallModelArgs,
  AgentCallModelResult,
  AgentModelResult,
  AgentModelProviders,
  AgentPhaseEvent,
  AgentRunState,
  RunAgentOptions,
  Turn
} from '@nanoagent/kernel'
import {
  attachJsonlLineReader,
  createMemoryModelAuthStore,
  createRpcHandler,
  withModelAuth,
  withModelFallback,
  withModelProviders,
  withModelRetry,
  withModelResultMapper,
  withShareSync,
  withSubagentTools
} from './index.js'

type Context = { id: string }

function baseOptions(): RunAgentOptions<Context> {
  return {
    state: { context: { id: 'ctx' } },
    maxTurns: 1,
    hooks: {
      onTurnPrepared: () => ({
        value: {
          model: 'openai/gpt-5-mini',
          messages: [{ role: 'user', content: 'hello' }]
        }
      })
    }
  }
}

function makeTurn(): Turn {
  return {
    turnId: 'turn-1',
    turn: 1,
    toolCalls: { pending: [], inFlight: [], completed: [] }
  }
}

function makeState(runId = 'run-1'): AgentRunState<Context> {
  return {
    runId,
    revision: 0,
    status: { type: 'running', phase: 'turn_started' },
    context: { id: 'ctx' },
    turns: [],
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function makeCallModelArgs(
  model = 'openai/gpt-5-mini'
): AgentCallModelArgs<Context> {
  return {
    context: { id: 'ctx' },
    state: makeState(),
    runId: 'run-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    args: {
      model,
      messages: [{ role: 'user', content: 'hello' }],
      toolNames: ['tool-a']
    } as AgentCallModelArgs<Context>['args'],
    turn: makeTurn()
  }
}

function makeCallModelResult(
  input: AgentCallModelArgs<Context>,
  overrides: Partial<AgentCallModelResult> = {}
): AgentCallModelResult {
  return {
    args: input.args,
    duration: 1,
    pendingToolCalls: [],
    rawResult: {
      tag: 'raw-result'
    } as unknown as AgentCallModelResult['rawResult'],
    result: {
      finishReason: 'stop',
      response: {
        id: 'response-1',
        modelId: 'openai/gpt-5-mini',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        messages: []
      },
      totalUsage: {
        inputTokens: 0,
        inputTokenDetails: {
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          noCacheTokens: 0
        },
        outputTokens: 0,
        outputTokenDetails: {
          reasoningTokens: undefined,
          textTokens: 0
        },
        totalTokens: 0
      }
    } as AgentModelResult,
    ...overrides
  }
}

async function runCallModel(
  middleware: NonNullable<RunAgentOptions<Context>['middleware']>['callModel'],
  input: AgentCallModelArgs<Context>,
  terminal: (
    input: AgentCallModelArgs<Context>
  ) => Promise<AgentCallModelResult> | AgentCallModelResult
) {
  const stack = [...(middleware ?? [])]
  const dispatch = (
    index: number,
    currentInput: AgentCallModelArgs<Context>
  ): Promise<AgentCallModelResult> => {
    const current = stack[index]
    if (!current) return Promise.resolve(terminal(currentInput))
    return Promise.resolve(
      current({
        input: currentInput,
        next: nextInput => dispatch(index + 1, nextInput)
      }) as AgentCallModelResult | PromiseLike<AgentCallModelResult>
    )
  }

  return dispatch(0, input)
}

function modelProvider(label: string): AgentModelProviders[string] {
  return modelName =>
    ({ provider: label, modelName }) as unknown as ReturnType<
      AgentModelProviders[string]
    >
}

function makeShareState(runId: string): AgentRunState<Context> {
  return {
    runId,
    revision: 0,
    status: { type: 'running', phase: 'turn_started' },
    context: { id: runId },
    turns: [],
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function makeShareEvent(
  runId: string,
  type: AgentPhaseEvent['type']
): AgentPhaseEvent {
  if (type === 'run_started') {
    return {
      type,
      runId,
      revision: 0,
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  }

  return {
    type,
    runId,
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    turn: makeTurn()
  } as AgentPhaseEvent
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('model plugins', () => {
  test('withModelProviders merges provider map', () => {
    const existing = { openai: modelProvider('existing') }
    const replacement = modelProvider('replacement')
    const added = modelProvider('added')

    const configured = withModelProviders<Context>({
      openai: replacement,
      local: added
    })({
      ...baseOptions(),
      modelProviders: existing
    })

    expect(configured.modelProviders).toEqual({
      openai: replacement,
      local: added
    })
  })

  test('withModelRetry retries once before success', async () => {
    const retryCalls: Array<[string, number]> = []
    const input = makeCallModelArgs()
    let attempts = 0
    const configured = withModelRetry<Context>({
      attempts: 3,
      retry: (error, attempt) => {
        retryCalls.push([String(error), attempt])
        return attempt < 2
      }
    })(baseOptions())

    const result = await runCallModel(
      configured.middleware?.callModel,
      input,
      async nextInput => {
        attempts += 1
        if (attempts === 1) throw new Error('transient')
        return makeCallModelResult(nextInput)
      }
    )

    expect(attempts).toBe(2)
    expect(retryCalls).toEqual([['Error: transient', 1]])
    expect(result.result.finishReason).toBe('stop')
  })

  test('withModelFallback walks model list until success', async () => {
    const models: string[] = []
    const configured = withModelFallback<Context>([
      'openai/fallback-one',
      'openai/fallback-two'
    ])(baseOptions())

    const result = await runCallModel(
      configured.middleware?.callModel,
      makeCallModelArgs('openai/base'),
      async nextInput => {
        models.push(nextInput.args.model)
        if (nextInput.args.model === 'openai/fallback-one') {
          throw new Error('first model failed')
        }
        return makeCallModelResult(nextInput)
      }
    )

    expect(models).toEqual(['openai/fallback-one', 'openai/fallback-two'])
    expect(result.args.model).toBe('openai/fallback-two')
  })

  test('withModelResultMapper sees context and returns mapped result', async () => {
    const input = makeCallModelArgs()
    const configured = withModelResultMapper<Context>(
      async ({ result, context }) => {
        expect(context).toEqual({ id: 'ctx' })
        return {
          ...result,
          result: {
            ...result.result,
            finishReason: 'mapped'
          }
        }
      }
    )(baseOptions())

    const result = await runCallModel(
      configured.middleware?.callModel,
      input,
      async nextInput => makeCallModelResult(nextInput)
    )

    expect(result.result.finishReason).toBe('mapped')
  })

  test('withModelAuth resolves api key and oauth token', async () => {
    const authCalls: Array<{ provider: string; token: string }> = []
    const configured = withModelAuth<Context>({
      providers: {
        local: modelProvider('local')
      },
      auth: createMemoryModelAuthStore({
        apiKeys: { OpenAI: 'api-openai' },
        oauthTokens: { Azure: 'oauth-azure' }
      }),
      apply: auth => {
        authCalls.push(auth)
      }
    })(baseOptions())

    await runCallModel(
      configured.middleware?.callModel,
      makeCallModelArgs('openai/gpt-5-mini'),
      async nextInput => makeCallModelResult(nextInput)
    )

    await runCallModel(
      configured.middleware?.callModel,
      makeCallModelArgs('azure/gpt-4.1'),
      async nextInput => makeCallModelResult(nextInput)
    )

    expect(configured.modelProviders?.local).toBeDefined()
    expect(authCalls).toEqual([
      { provider: 'openai', token: 'api-openai' },
      { provider: 'azure', token: 'oauth-azure' }
    ])
  })

  test('createRpcHandler writes success and failure responses', async () => {
    const writes: string[] = []
    const handler = createRpcHandler({
      handle: async command => {
        if (command.type === 'explode') throw new Error('boom')
        return { echoed: command.type, id: command.id }
      },
      output: {
        write: chunk => {
          writes.push(chunk)
          return true
        }
      }
    })

    await handler({ id: 7, type: 'ping' })
    await handler({ id: 8, type: 'explode' })

    expect(writes.map(line => JSON.parse(line))).toEqual([
      {
        id: 7,
        type: 'response',
        command: 'ping',
        success: true,
        data: { echoed: 'ping', id: 7 }
      },
      {
        id: 8,
        type: 'response',
        command: 'explode',
        success: false,
        error: 'boom'
      }
    ])
  })

  test('attachJsonlLineReader reports parse errors and keeps valid commands', async () => {
    const input = new PassThrough()
    const commands: Array<Record<string, unknown>> = []
    const errors: string[] = []
    const detach = attachJsonlLineReader(
      input,
      command => {
        commands.push(command)
      },
      error => {
        errors.push(error.message)
      }
    )

    input.write('{"type":"spawn_agent","id":"1"}\n')
    input.write('[\n')
    input.write('{"type":1}\n')

    await sleep(0)
    detach()

    expect(commands).toEqual([{ type: 'spawn_agent', id: '1' }])
    expect(errors[0]).toContain('JSON')
    expect(errors[1]).toBe('JSONL RPC command type must be a string.')
  })

  test('withShareSync flushes immediately and debounces to latest payload', async () => {
    const writes: Array<{ label: string; payload: unknown }> = []
    const immediate = withShareSync<Context>({
      client: {
        sync: async payload => {
          writes.push({ label: 'sync', payload })
        }
      }
    })(baseOptions())

    await immediate.saveState?.({
      state: makeShareState('run-immediate'),
      events: [makeShareEvent('run-immediate', 'run_started')]
    })

    expect(writes).toHaveLength(1)
    expect(
      (writes[0]?.payload as { state: { runId: string } }).state.runId
    ).toBe('run-immediate')

    const debouncedWrites: Array<{ label: string; payload: unknown }> = []
    const debounced = withShareSync<Context>({
      debounceMs: 10,
      client: {
        sync: async payload => {
          debouncedWrites.push({ label: 'sync', payload })
        }
      }
    })(baseOptions())

    await debounced.saveState?.({
      state: makeShareState('run-first'),
      events: [makeShareEvent('run-first', 'run_started')]
    })
    await debounced.saveState?.({
      state: makeShareState('run-second'),
      events: [makeShareEvent('run-second', 'turn_started')]
    })

    expect(debouncedWrites).toHaveLength(0)
    await sleep(30)

    expect(debouncedWrites).toHaveLength(1)
    expect(
      (
        debouncedWrites[0]?.payload as {
          state: { runId: string }
          events: AgentPhaseEvent[]
        }
      ).state.runId
    ).toBe('run-second')
    expect(
      (
        debouncedWrites[0]?.payload as {
          state: { runId: string }
          events: AgentPhaseEvent[]
        }
      ).events[0]?.type
    ).toBe('turn_started')
  })

  test('withSubagentTools supports spawn, send, wait, resume, and close lifecycle', async () => {
    const calls: Array<[string, unknown]> = []
    const configured = withSubagentTools<Context>({
      spawn: params => {
        calls.push(['spawn', params])
        return { agent_id: 'agent-1' }
      },
      send: params => {
        calls.push(['send', params])
        return { submission_id: 'submission-1' }
      },
      wait: params => {
        calls.push(['wait', params])
        return { agent_statuses: { 'agent-1': 'completed' } }
      },
      resume: params => {
        calls.push(['resume', params])
        return { status: 'running' }
      },
      close: params => {
        calls.push(['close', params])
        return { status: 'shutdown' }
      }
    })(baseOptions())

    await configured.tools!.spawn_agent!.execute!(
      {
        items: [
          { type: 'text', text: 'start' },
          { type: 'skill', name: 'inspect' }
        ],
        agent_type: 'explorer',
        model: 'openai/gpt-5-mini',
        reasoning_effort: 'medium'
      },
      { toolCallId: 'spawn', messages: [], experimental_context: { id: 'ctx' } }
    )

    await configured.tools!.send_input!.execute!(
      { target: 'agent-1', message: 'continue' },
      {
        toolCallId: 'send-1',
        messages: [],
        experimental_context: { id: 'ctx' }
      }
    )

    await configured.tools!.send_input!.execute!(
      {
        target: 'agent-1',
        items: [{ type: 'text', text: 'second message' }],
        interrupt: true
      },
      {
        toolCallId: 'send-2',
        messages: [],
        experimental_context: { id: 'ctx' }
      }
    )

    await configured.tools!.wait_agent!.execute!(
      { targets: ['agent-1', 'agent-2'], timeout_ms: 12_000 },
      { toolCallId: 'wait', messages: [], experimental_context: { id: 'ctx' } }
    )

    await configured.tools!.resume_agent!.execute!(
      { id: 'agent-1' },
      {
        toolCallId: 'resume',
        messages: [],
        experimental_context: { id: 'ctx' }
      }
    )

    await configured.tools!.close_agent!.execute!(
      { target: 'agent-1' },
      { toolCallId: 'close', messages: [], experimental_context: { id: 'ctx' } }
    )

    expect(calls.map(([name]) => name)).toEqual([
      'spawn',
      'send',
      'send',
      'wait',
      'resume',
      'close'
    ])
    expect(calls[0]?.[1]).toMatchObject({
      items: [
        { type: 'text', text: 'start' },
        { type: 'skill', name: 'inspect' }
      ],
      agentType: 'explorer',
      model: 'openai/gpt-5-mini',
      reasoningEffort: 'medium',
      context: { id: 'ctx' }
    })
    expect(calls[1]?.[1]).toMatchObject({
      target: 'agent-1',
      message: 'continue',
      interrupt: false,
      context: { id: 'ctx' }
    })
    expect(calls[2]?.[1]).toMatchObject({
      target: 'agent-1',
      items: [{ type: 'text', text: 'second message' }],
      interrupt: true
    })
    expect(calls[3]?.[1]).toMatchObject({
      targets: ['agent-1', 'agent-2'],
      timeoutMs: 12_000
    })
  })
})
