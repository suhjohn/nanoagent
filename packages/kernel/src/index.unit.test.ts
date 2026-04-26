import { describe, expect, test } from 'bun:test'
import type { LanguageModelUsage, ToolSet } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import {
  type AgentSaveState,
  type AgentModelResult,
  type AgentPhase,
  type AgentPhaseEvent,
  type AgentHooks,
  type AgentRunState,
  type AgentToolCall,
  type AgentToolCallResponse,
  type JsonLike,
  type Turn,
  runAgent
} from './index'

type UnitContext = {
  [key: string]: JsonLike
  approvedToolCallIds: string[]
  completed: string[]
  events: string[]
  pendingToolCallId: string | null
}

const usage = {
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
} satisfies LanguageModelUsage

async function collect<EVENT>(events: AsyncIterable<EVENT>): Promise<EVENT[]> {
  const collected: EVENT[] = []
  for await (const event of events) {
    collected.push(event)
  }
  return collected
}

function makeSnapshotRecorder<CONTEXT extends JsonLike>() {
  const snapshots: Array<AgentRunState<CONTEXT>> = []
  const events: Array<AgentPhaseEvent> = []
  const saveState: AgentSaveState<CONTEXT> = ({
    state,
    events: nextEvents
  }) => {
    snapshots.push(structuredClone(state))
    events.push(...structuredClone(nextEvents))
  }

  return {
    saveState,
    events,
    latest: () => snapshots.at(-1),
    snapshots
  }
}

function makeModelResult(
  finishReason: string | undefined
): AgentModelResult {
  return {
    finishReason,
    response: {
      id: 'test-response',
      messages: [],
      modelId: 'test/model',
      timestamp: new Date(0)
    },
    totalUsage: usage
  }
}

function baseContext(overrides: Partial<UnitContext> = {}): UnitContext {
  return {
    approvedToolCallIds: [],
    completed: [],
    events: [],
    pendingToolCallId: null,
    ...overrides
  }
}

function toolCall(
  toolCallId: string,
  toolName: string,
  input: JsonLike = {}
): AgentToolCall {
  return {
    toolCallId,
    toolName,
    input
  }
}

function toolResponse(
  toolCallId: string,
  toolName: string,
  output: JsonLike
): AgentToolCallResponse {
  return {
    toolCallId,
    toolName,
    input: {},
    output
  }
}

function modelCompletedSnapshot({
  context = baseContext(),
  completed = [],
  inFlight = [],
  pending,
  phase = 'model_completed',
  revision = 10
}: {
  context?: UnitContext
  completed?: AgentToolCallResponse[]
  inFlight?: AgentToolCall[]
  pending: AgentToolCall[]
  phase?: AgentPhase
  revision?: number
}): AgentRunState<UnitContext> {
  const currentTurn: Turn = {
    turnId: 'turn-1',
    turn: 1,
    modelArgs: {
      model: 'test/model',
      messages: [{ role: 'user', content: 'run tools' }],
      toolNames: ['A', 'B', 'C', 'Boom']
    },
    modelResult: makeModelResult('tool-calls'),
    toolCalls: {
      pending,
      inFlight,
      completed
    }
  }
  return {
    runId: 'unit-run',
    revision,
    status: { type: 'running', phase },
    context,
    turns: [],
    currentTurn,
    updatedAt: new Date(0).toISOString()
  }
}

function tools(log: string[] = []) {
  return {
    A: {
      execute: (input: unknown) => {
        log.push(`A:${JSON.stringify(input)}`)
        return 'a-output'
      }
    },
    B: {
      execute: (input: unknown) => {
        log.push(`B:${JSON.stringify(input)}`)
        return 'b-output'
      }
    },
    C: {
      execute: (input: unknown) => {
        log.push(`C:${JSON.stringify(input)}`)
        return 'c-output'
      }
    },
    Boom: {
      execute: () => {
        log.push('Boom')
        throw new Error('boom')
      }
    }
  } as unknown as ToolSet
}

function mkRuntime(
  state: AgentRunState<UnitContext> | { context: UnitContext; runId?: string },
  toolSet: ToolSet = {}
) {
  return { state, tools: toolSet }
}

function resumeOnlyHooks(
  overrides: Partial<AgentHooks<UnitContext>> = {}
): AgentHooks<UnitContext> {
  return {
    onTurnPrepared: () => {
      throw new Error('unit resume test should not prepare a fresh turn')
    },
    onTurnCompleted: () => ({ control: { type: 'finish' } }),
    ...overrides
  }
}

function lastCompletedTurn<C extends JsonLike>(
  state: AgentRunState<C> | undefined
) {
  return state?.turns.at(-1)
}

describe('runAgent unit durability scenarios', () => {
  test('pauses on the second tool and preserves accepted, paused, and remaining tool calls', async () => {
    const log: string[] = []
    const snapshot = modelCompletedSnapshot({
      pending: [
        toolCall('call-a', 'A'),
        toolCall('call-b', 'B'),
        toolCall('call-c', 'C')
      ]
    })
    const toolSet = tools(log)
    const hooks = resumeOnlyHooks({
      onToolCallStarted: ({ context, toolCallId }) => {
        if (
          toolCallId === 'call-b' &&
          !context.approvedToolCallIds.includes(toolCallId)
        ) {
          return {
            context: {
              ...context,
              approvedToolCallIds: [...context.approvedToolCallIds],
              completed: [...context.completed],
              events: [...context.events],
              pendingToolCallId: toolCallId
            },
            control: {
              type: 'pause',
              reason: 'approval_required',
              metadata: { toolCallId }
            }
          }
        }
      }
    })
    const firstRecorder = makeSnapshotRecorder<UnitContext>()

    const firstEvents = await collect(
      runAgent({
        saveState: firstRecorder.saveState,
        maxTurns: 3,
        hooks,
        ...mkRuntime(snapshot, toolSet)
      })
    )
    const pausedSnapshot = firstRecorder.latest()

    expect(firstEvents.at(-1)?.type).toBe('pause')
    expect(pausedSnapshot?.context.pendingToolCallId).toBe('call-b')
    expect(
      pausedSnapshot?.currentTurn?.toolCalls.pending.map(
        call => call.toolCallId
      )
    ).toEqual(['call-a', 'call-b', 'call-c'])
    expect(log).toEqual([])

    const secondRecorder = makeSnapshotRecorder<UnitContext>()
    await collect(
      runAgent({
        saveState: secondRecorder.saveState,
        maxTurns: 3,
        hooks,
        ...mkRuntime(
          {
            ...pausedSnapshot!,
            context: {
              ...pausedSnapshot!.context,
              approvedToolCallIds: ['call-b']
            }
          },
          toolSet
        )
      })
    )

    expect(secondRecorder.latest()?.status.type).toBe('completed')
    expect(log.map(entry => entry[0])).toEqual(['A', 'B', 'C'])
  })

  test('skips a denied tool and continues with an error-like tool result', async () => {
    const recorder = makeSnapshotRecorder<UnitContext>()
    await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 3,
        hooks: resumeOnlyHooks({
          onToolCallStarted: ({ input, toolCallId, toolName }) => {
            if (toolName === 'B') {
              return {
                value: {
                  type: 'skip',
                  result: {
                    toolCallId,
                    toolName,
                    input,
                    error: 'denied by policy'
                  }
                }
              }
            }
          }
        }),
        ...mkRuntime(
          modelCompletedSnapshot({
            pending: [
              toolCall('call-a', 'A'),
              toolCall('call-b', 'B'),
              toolCall('call-c', 'C')
            ]
          }),
          tools()
        )
      })
    )
    const toolResults =
      lastCompletedTurn(recorder.latest())?.toolCalls.completed ?? []

    expect(recorder.latest()?.status.type).toBe('completed')
    expect(toolResults).toHaveLength(3)
    expect(toolResults.find(result => result.toolName === 'B')).toMatchObject({
      error: 'denied by policy',
      toolCallId: 'call-b'
    })
  })

  test('resumes after model_started by restarting the model call', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'ok' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined
                },
                outputTokens: {
                  total: 1,
                  text: 1,
                  reasoning: undefined
                }
              }
            }
          ]
        })
      })
    })
    const recorder = makeSnapshotRecorder<UnitContext>()
    const base = modelCompletedSnapshot({
      pending: [],
      phase: 'model_started'
    })
    const snapshot: AgentRunState<UnitContext> = {
      ...base,
      currentTurn: {
        turnId: 'turn-1',
        turn: 1,
        modelArgs: {
          model: 'test/model',
          messages: [{ role: 'user', content: 'say ok' }],
          toolNames: []
        },
        toolCalls: { pending: [], inFlight: [], completed: [] }
      }
    }

    const restarted: string[] = []
    const events = await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 1,
        hooks: {
          ...resumeOnlyHooks(),
          onModelRestarted: args => {
            restarted.push(`${args.turn.turn}:${args.state.status.type}`)
          }
        },
        state: snapshot,
        modelProviders: { test: () => mockModel as never }
      })
    )

    expect(events.map(event => event.type)).toContain('model_restarted')
    expect(restarted).toEqual(['1:running'])
    expect(mockModel.doStreamCalls).toHaveLength(1)
    expect(recorder.latest()?.status.type).toBe('completed')
  })

  test('resumes after tool_call_completed when no calls are in flight', async () => {
    const log: string[] = []
    const recorder = makeSnapshotRecorder<UnitContext>()
    await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 3,
        hooks: resumeOnlyHooks(),
        ...mkRuntime(
          modelCompletedSnapshot({
            completed: [toolResponse('call-a', 'A', 'a-output')],
            pending: [],
            phase: 'tool_call_completed'
          }),
          tools(log)
        )
      })
    )

    expect(log).toEqual([])
    expect(recorder.events.map(event => event.type)).toEqual([
      'tool_calls_completed',
      'turn_completed',
      'run_completed'
    ])
  })

  test('fails explicitly when resuming with in-flight tool calls', async () => {
    const recorder = makeSnapshotRecorder<UnitContext>()

    await expect(
      collect(
        runAgent({
          saveState: recorder.saveState,
          maxTurns: 3,
          hooks: resumeOnlyHooks(),
          ...mkRuntime(
            modelCompletedSnapshot({
              completed: [toolResponse('call-a', 'A', 'a-output')],
              inFlight: [toolCall('call-b', 'B')],
              pending: [],
              phase: 'tool_call_completed'
            }),
            tools()
          )
        })
      )
    ).rejects.toThrow('Cannot safely resume while tool calls are in flight.')
    expect(recorder.latest()?.status.type).toBe('failed')
  })

  test('snapshots context-only hook updates even when no event is emitted', async () => {
    const recorder = makeSnapshotRecorder<UnitContext>()
    await collect(
      runAgent({
        saveState: recorder.saveState,
        ...mkRuntime({ context: baseContext() }),
        maxTurns: 1,
        hooks: {
          onTurnStarted: ({ context }) => ({
            context: {
              ...context,
              approvedToolCallIds: [...context.approvedToolCallIds],
              completed: [...context.completed],
              events: [...context.events, 'turn-started-context-only'],
              pendingToolCallId: context.pendingToolCallId
            }
          }),
          onTurnPrepared: () => ({
            control: {
              type: 'pause',
              reason: 'stop-after-context-only-update'
            }
          })
        }
      })
    )

    expect(
      recorder.snapshots.some(
        snapshot =>
          snapshot.context.events.includes('turn-started-context-only') &&
          snapshot.status.type === 'running' &&
          snapshot.status.phase === 'turn_started'
      )
    ).toBe(true)
  })

  test('resumes turn_started by retrying turn preparation', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined
                },
                outputTokens: {
                  total: 1,
                  text: 1,
                  reasoning: undefined
                }
              }
            }
          ]
        })
      })
    })
    const firstRecorder = makeSnapshotRecorder<UnitContext>()
    await collect(
      runAgent({
        saveState: firstRecorder.saveState,
        state: { context: baseContext() },
        maxTurns: 1,
        hooks: {
          onTurnPrepared: () => ({
            control: {
              type: 'pause',
              reason: 'awaiting_input'
            }
          })
        }
      })
    )
    const paused = firstRecorder.latest()
    expect(paused?.status).toMatchObject({
      type: 'paused',
      phase: 'turn_started',
      reason: 'awaiting_input'
    })

    const secondRecorder = makeSnapshotRecorder<UnitContext>()
    await collect(
      runAgent({
        saveState: secondRecorder.saveState,
        state: paused!,
        modelProviders: { test: () => mockModel as never },
        maxTurns: 1,
        hooks: {
          onTurnPrepared: () => ({
            value: {
              model: 'test/model',
              messages: [{ role: 'user', content: 'ready' }]
            }
          })
        }
      })
    )

    expect(mockModel.doStreamCalls).toHaveLength(1)
    expect(secondRecorder.events.map(event => event.type)).toContain(
      'turn_prepared'
    )
    expect(secondRecorder.latest()?.status.type).toBe('completed')
  })

  test('caller abort throws without snapshotting run_failed', async () => {
    const controller = new AbortController()
    controller.abort(new Error('caller stopped'))
    const recorder = makeSnapshotRecorder<UnitContext>()

    await expect(
      collect(
        runAgent({
          saveState: recorder.saveState,
          ...mkRuntime({ context: baseContext() }),
          maxTurns: 1,
          hooks: {
            onTurnPrepared: () => ({
              value: {
                model: 'test/model',
                messages: []
              }
            })
          },
          signal: controller.signal
        })
      )
    ).rejects.toThrow('caller stopped')
    expect(recorder.events.map(event => event.type)).not.toContain('run_failed')
  })

  test('records tool execution errors and still completes the run', async () => {
    const recorder = makeSnapshotRecorder<UnitContext>()
    await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 3,
        hooks: resumeOnlyHooks({
          onToolCallCompleted: ({ context, toolName }) => ({
            context: {
              ...context,
              approvedToolCallIds: [...context.approvedToolCallIds],
              completed: [...context.completed, toolName],
              events: [...context.events],
              pendingToolCallId: context.pendingToolCallId
            }
          })
        }),
        ...mkRuntime(
          modelCompletedSnapshot({
            pending: [toolCall('call-boom', 'Boom')]
          }),
          tools()
        )
      })
    )
    const completedCall = lastCompletedTurn(recorder.latest())?.toolCalls
      .completed[0]

    expect(recorder.latest()?.status.type).toBe('completed')
    expect(completedCall).toMatchObject({
      toolCallId: 'call-boom',
      toolName: 'Boom'
    })
    expect('error' in completedCall!).toBe(true)
    expect(recorder.latest()?.context.completed).toEqual(['Boom'])
  })

  test('applies batch and per-tool transformations before execution', async () => {
    const log: string[] = []
    const recorder = makeSnapshotRecorder<UnitContext>()
    await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 3,
        hooks: resumeOnlyHooks({
          onToolCallsStarted: ({ toolCalls }) => ({
            value: toolCalls.map(call => ({
              ...call,
              input: { ...(call.input as object), batch: true }
            }))
          }),
          onToolCallStarted: ({ toolCall }) => ({
            value: {
              ...toolCall,
              input: { ...(toolCall.input as object), single: true }
            }
          })
        }),
        ...mkRuntime(
          modelCompletedSnapshot({
            pending: [toolCall('call-a', 'A', { original: true })]
          }),
          tools(log)
        )
      })
    )

    expect(log).toEqual(['A:{"original":true,"batch":true,"single":true}'])
  })

  test('passes readonly hook arguments', async () => {
    const recorder = makeSnapshotRecorder<UnitContext>()
    const mutationThrows = {
      context: false,
      snapshot: false,
      toolCall: false
    }

    await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 3,
        hooks: resumeOnlyHooks({
          onToolCallsStarted: ({ context, state }) => {
            try {
              ;(context.completed as string[]).push('mutated')
            } catch {
              mutationThrows.context = true
            }
            try {
              ;(state.turns as unknown[]).push({})
            } catch {
              mutationThrows.snapshot = true
            }
          },
          onToolCallStarted: ({ toolCall }) => {
            try {
              ;(toolCall as { input: unknown }).input = { mutated: true }
            } catch {
              mutationThrows.toolCall = true
            }
          }
        }),
        ...mkRuntime(
          modelCompletedSnapshot({
            pending: [toolCall('call-a', 'A')]
          }),
          tools()
        )
      })
    )

    expect(mutationThrows).toEqual({
      context: true,
      snapshot: true,
      toolCall: true
    })
  })

  test('onPause observes persisted pause state before caller collects event', async () => {
    const recorder = makeSnapshotRecorder<UnitContext>()
    const observed: string[] = []
    const mutationThrows: string[] = []

    const events = await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 1,
        hooks: {
          onTurnPrepared: () => ({
            value: {
              model: 'openai/gpt-5.4-nano',
              messages: [{ role: 'user', content: 'pause' }]
            }
          }),
          onModelStarted: () => ({
            control: { type: 'pause', reason: 'check' }
          }),
          onPause: args => {
            observed.push(`${args.phase}:${args.state.status.type}`)
            try {
              ;(args.state as unknown as { context: UnitContext }).context =
                baseContext()
            } catch {
              mutationThrows.push('state')
            }
          }
        },
        state: { context: baseContext() }
      })
    )

    expect(events.at(-1)).toMatchObject({ type: 'pause', reason: 'check' })
    expect(recorder.latest()?.status).toMatchObject({
      type: 'paused',
      phase: 'model_started',
      reason: 'check'
    })
    expect(observed).toEqual(['model_started:paused'])
    expect(mutationThrows).toEqual(['state'])
  })

  test('callTool middleware can short-circuit tool execution', async () => {
    const log: string[] = []
    const recorder = makeSnapshotRecorder<UnitContext>()

    await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 3,
        middleware: {
          callTool: [
            ({ input, next }) =>
              input.toolCall.toolName === 'B'
                ? {
                    toolCallId: input.toolCall.toolCallId,
                    toolName: input.toolCall.toolName,
                    input: input.toolCall.input,
                    error: 'blocked by middleware'
                  }
                : next(input)
          ]
        },
        hooks: resumeOnlyHooks(),
        ...mkRuntime(
          modelCompletedSnapshot({
            pending: [toolCall('call-a', 'A'), toolCall('call-b', 'B')]
          }),
          tools(log)
        )
      })
    )

    expect(log).toEqual(['A:{}'])
    expect(lastCompletedTurn(recorder.latest())?.toolCalls.completed).toEqual([
      {
        toolCallId: 'call-a',
        toolName: 'A',
        input: {},
        output: 'a-output'
      },
      {
        toolCallId: 'call-b',
        toolName: 'B',
        input: {},
        error: 'blocked by middleware'
      }
    ])
  })

  test('middleware next composes without callers writing Effect', async () => {
    const log: string[] = []
    const recorder = makeSnapshotRecorder<UnitContext>()

    await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 3,
        middleware: {
          callTool: [
            ({ input, next }) =>
              next({
                ...input,
                toolCall: {
                  ...input.toolCall,
                  input: { wrapped: true }
                }
              }).then(result =>
                'error' in result
                  ? result
                  : {
                      ...result,
                      output: `${result.output}:wrapped`
                    }
              )
          ]
        },
        hooks: resumeOnlyHooks(),
        ...mkRuntime(
          modelCompletedSnapshot({
            pending: [toolCall('call-a', 'A')]
          }),
          tools(log)
        )
      })
    )

    expect(log).toEqual(['A:{"wrapped":true}'])
    expect(
      lastCompletedTurn(recorder.latest())?.toolCalls.completed[0]
    ).toMatchObject({
      output: 'a-output:wrapped'
    })
  })

  test('passes streamText options through turn preparation', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined
                },
                outputTokens: {
                  total: 1,
                  text: 1,
                  reasoning: undefined
                }
              }
            }
          ]
        })
      })
    })

    await collect(
      runAgent({
        state: { context: baseContext() },
        modelProviders: { test: () => mockModel as never },
        maxTurns: 1,
        hooks: {
          onTurnPrepared: () => ({
            value: {
              model: 'test/model',
              prompt: 'say ok',
              system: 'system message',
              temperature: 0.2,
              maxOutputTokens: 7,
              headers: { 'x-test': 'yes' }
            }
          })
        }
      })
    )

    expect(mockModel.doStreamCalls[0]).toMatchObject({
      headers: { 'x-test': 'yes' },
      maxOutputTokens: 7,
      temperature: 0.2
    })
  })

  test('caller-emitted finish records completion source, reason, and metadata', async () => {
    const recorder = makeSnapshotRecorder<UnitContext>()
    const events = await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 3,
        hooks: resumeOnlyHooks({
          onTurnCompleted: () => ({
            control: {
              type: 'finish',
              reason: 'all_done',
              metadata: { tag: 'unit' }
            }
          })
        }),
        ...mkRuntime(
          modelCompletedSnapshot({
            pending: [toolCall('call-a', 'A')]
          }),
          tools()
        )
      })
    )
    const completedEvent = events.find(event => event.type === 'run_completed')
    const completedSnapshot = recorder.latest()

    expect(completedEvent).toMatchObject({
      type: 'run_completed',
      source: 'caller',
      reason: 'all_done',
      metadata: { tag: 'unit' }
    })
    expect(completedSnapshot?.status).toMatchObject({
      type: 'completed',
      source: 'caller',
      reason: 'all_done',
      metadata: { tag: 'unit' }
    })
    expect(completedSnapshot?.turns).toHaveLength(1)
  })

  test('finish emitted mid-tool-batch from onToolCallCompleted ends the run', async () => {
    const log: string[] = []
    const recorder = makeSnapshotRecorder<UnitContext>()
    await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 3,
        hooks: {
          onTurnPrepared: () => {
            throw new Error('should not prepare a fresh turn')
          },
          onToolCallCompleted: ({ toolName }) =>
            toolName === 'A'
              ? { control: { type: 'finish', reason: 'first_tool_done' } }
              : undefined
        },
        ...mkRuntime(
          modelCompletedSnapshot({
            pending: [toolCall('call-a', 'A'), toolCall('call-b', 'B')]
          }),
          tools(log)
        )
      })
    )
    const completedSnapshot = recorder.latest()

    expect(completedSnapshot?.status).toMatchObject({
      type: 'completed',
      source: 'caller',
      reason: 'first_tool_done'
    })
    expect(recorder.events.map(event => event.type)).toContain('run_completed')
    expect(recorder.events.map(event => event.type)).not.toContain(
      'turn_completed'
    )
  })

  test('natural completion records source model_done with no caller signal', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'done' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined
                },
                outputTokens: {
                  total: 1,
                  text: 1,
                  reasoning: undefined
                }
              }
            }
          ]
        })
      })
    })
    const recorder = makeSnapshotRecorder<UnitContext>()
    const events = await collect(
      runAgent({
        saveState: recorder.saveState,
        state: { context: baseContext() },
        modelProviders: { test: () => mockModel as never },
        maxTurns: 3,
        hooks: {
          onTurnPrepared: () => ({
            value: {
              model: 'test/model',
              messages: [{ role: 'user', content: 'say done' }]
            }
          })
        }
      })
    )
    const completedEvent = events.find(event => event.type === 'run_completed')
    const status = recorder.latest()?.status

    expect(completedEvent).toMatchObject({
      type: 'run_completed',
      source: 'model_done'
    })
    expect(status?.type).toBe('completed')
    if (status?.type === 'completed') {
      expect(status.source).toBe('model_done')
    }
  })

  test('caller-emitted continue starts another turn without tool calls', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined
                },
                outputTokens: {
                  total: 1,
                  text: 1,
                  reasoning: undefined
                }
              }
            }
          ]
        })
      })
    })
    const recorder = makeSnapshotRecorder<UnitContext>()
    const events = await collect(
      runAgent({
        saveState: recorder.saveState,
        state: { context: baseContext() },
        modelProviders: { test: () => mockModel as never },
        maxTurns: 3,
        hooks: {
          onTurnPrepared: () => ({
            value: {
              model: 'test/model',
              messages: [{ role: 'user', content: 'continue once' }]
            }
          }),
          onTurnCompleted: ({ turn }) =>
            turn.turn === 1 ? { control: { type: 'continue' } } : undefined
        }
      })
    )
    const completedEvent = events.find(event => event.type === 'run_completed')

    expect(mockModel.doStreamCalls).toHaveLength(2)
    expect(completedEvent).toMatchObject({
      type: 'run_completed',
      source: 'model_done'
    })
    expect(recorder.latest()?.turns).toHaveLength(2)
  })

  test('max_turns cap completes the run with source max_turns', async () => {
    const log: string[] = []
    const recorder = makeSnapshotRecorder<UnitContext>()
    const events = await collect(
      runAgent({
        saveState: recorder.saveState,
        maxTurns: 1,
        hooks: {
          onTurnPrepared: () => {
            throw new Error('no fresh turn expected at max_turns boundary')
          }
        },
        ...mkRuntime(
          modelCompletedSnapshot({
            pending: [toolCall('call-a', 'A')]
          }),
          tools(log)
        )
      })
    )
    const completedEvent = events.find(event => event.type === 'run_completed')

    expect(completedEvent).toMatchObject({
      type: 'run_completed',
      source: 'max_turns',
      metadata: { maxTurns: 1 }
    })
    expect(recorder.latest()?.status).toMatchObject({
      type: 'completed',
      source: 'max_turns',
      metadata: { maxTurns: 1 }
    })
  })

  test('onStreamUpdate receives model stream parts before caller collects them', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'ok' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined
                },
                outputTokens: {
                  total: 1,
                  text: 1,
                  reasoning: undefined
                }
              }
            }
          ]
        })
      })
    })
    const order: string[] = []
    const collectedParts: string[] = []
    const createdAtValues: string[] = []

    const events = runAgent({
      state: { context: baseContext() },
      modelProviders: { test: () => mockModel as never },
      maxTurns: 1,
      hooks: {
        onTurnPrepared: () => ({
          value: {
            model: 'test/model',
            messages: [{ role: 'user', content: 'say ok' }]
          }
        }),
        onStreamUpdate: ({ createdAt, part }) => {
          if (part.type === 'text-delta') {
            order.push(`hook:${part.text}`)
            createdAtValues.push(createdAt)
          }
        }
      }
    })

    for await (const event of events) {
      if (event.type === 'stream_part' && event.part.type === 'text-delta') {
        order.push(`yield:${event.part.text}`)
        collectedParts.push(event.part.text)
        createdAtValues.push(event.createdAt)
      }
    }

    expect(order).toEqual(['hook:ok', 'yield:ok'])
    expect(collectedParts).toEqual(['ok'])
    expect(createdAtValues).toHaveLength(2)
    expect(createdAtValues[0]).toBe(createdAtValues[1])
    expect(Date.parse(createdAtValues[0] ?? '')).not.toBeNaN()
  })
})
