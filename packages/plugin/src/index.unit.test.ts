import { Effect } from 'effect'
import { describe, expect, test } from 'bun:test'
import type {
  AgentCallToolArgs,
  AgentMiddleware,
  AgentToolCallResponse,
  AgentTurnCompletedArgs,
  AgentTurnPreparedArgs,
  RunAgentOptions
} from '@nanoagent/kernel'
import { withPlugins } from './index'

type Context = {
  count: number
  other?: string
  yetAnother?: string
}

function baseOptions(): RunAgentOptions<Context> {
  return {
    state: {
      context: {
        count: 0
      },
      runId: 'run'
    },
    maxTurns: 1,
    hooks: {
      onTurnPrepared: async () => ({
        value: {
          model: 'test/model',
          messages: []
        }
      })
    }
  }
}

function turnCompletedArgs(): AgentTurnCompletedArgs<Context> {
  return {
    context: { count: 0 },
    createdAt: 'now',
    duration: 0,
    runId: 'run',
    state: {
      context: {
        count: 0
      },
      runId: 'run',
      revision: 0,
      status: {
        type: 'running',
        phase: 'turn_completed'
      },
      turns: [],
      updatedAt: 'now'
    },
    turn: {
      turnId: 'turn',
      turn: 1,
      toolCalls: {
        pending: [],
        inFlight: [],
        completed: []
      }
    }
  }
}

function turnPreparedArgs(): AgentTurnPreparedArgs<Context> {
  return {
    context: { count: 0 },
    createdAt: 'now',
    runId: 'run',
    state: {
      context: {
        count: 0
      },
      runId: 'run',
      revision: 0,
      status: {
        type: 'running',
        phase: 'turn_started'
      },
      turns: [],
      currentTurn: {
        turnId: 'turn',
        turn: 1,
        toolCalls: {
          pending: [],
          inFlight: [],
          completed: []
        }
      },
      updatedAt: 'now'
    },
    turn: {
      turnId: 'turn',
      turn: 1,
      toolCalls: {
        pending: [],
        inFlight: [],
        completed: []
      }
    }
  }
}

describe('withPlugins', () => {
  test('merges tools without dropping existing tools', () => {
    const one = { description: 'one', inputSchema: {} } as never
    const two = { description: 'two', inputSchema: {} } as never
    const options = withPlugins(baseOptions(), [
      { tools: { one } },
      { tools: { two } }
    ])

    expect(Object.keys(options.tools ?? {})).toEqual(['one', 'two'])
  })

  test('merges providers', () => {
    const first = (() => null) as never
    const second = (() => null) as never
    const options = withPlugins(baseOptions(), [
      { modelProviders: { first } },
      { modelProviders: { second } }
    ])

    expect(Object.keys(options.modelProviders ?? {})).toEqual([
      'first',
      'second'
    ])
  })

  test('appends middleware arrays', () => {
    const first: AgentMiddleware<
      AgentCallToolArgs<Context>,
      AgentToolCallResponse
    > = async ({ next, input }) => next(input)
    const second: AgentMiddleware<
      AgentCallToolArgs<Context>,
      AgentToolCallResponse
    > = async ({ next, input }) => next(input)
    const options = withPlugins(baseOptions(), [
      { middleware: { callTool: [first] } },
      { middleware: { callTool: [second] } }
    ])

    expect(options.middleware?.callTool).toEqual([first, second])
  })

  test('chains hooks and forwards updated context (shallow merge)', async () => {
    const seen: number[] = []
    const options = withPlugins(baseOptions(), [
      {
        hooks: {
          onTurnCompleted: async ({ context }) => ({
            context: { count: context.count + 1, other: 'kept' }
          })
        }
      },
      {
        hooks: {
          onTurnCompleted: async ({ context }) => {
            seen.push(context.count)
            return {
              context: { count: context.count + 1, yetAnother: 'added' }
            }
          }
        }
      }
    ])

    const rawResult = options.hooks?.onTurnCompleted?.(turnCompletedArgs())
    const result = await (Effect.isEffect(rawResult)
      ? Effect.runPromise(rawResult as never)
      : rawResult)

    expect(seen).toEqual([1])
    expect(result).toEqual({
      context: { count: 2, other: 'kept', yetAnother: 'added' }
    })
  })

  test('chains onTurnPrepared as message reducers', async () => {
    const seen: number[] = []
    const options = withPlugins(baseOptions(), [
      {
        hooks: {
          onTurnPrepared: async ({ turn }) => {
            const messages = turn.modelArgs?.messages ?? []
            seen.push(messages.length)
            return {
              value: {
                model: turn.modelArgs?.model ?? 'test/model',
                messages: [
                  ...messages,
                  { role: 'user' as const, content: 'first' }
                ]
              }
            }
          }
        }
      },
      {
        hooks: {
          onTurnPrepared: async ({ turn }) => {
            const messages = turn.modelArgs?.messages ?? []
            seen.push(messages.length)
            return {
              value: {
                model: turn.modelArgs?.model ?? 'test/model',
                messages: [
                  ...messages,
                  { role: 'user' as const, content: 'second' }
                ]
              }
            }
          }
        }
      }
    ])

    const rawResult = options.hooks.onTurnPrepared(turnPreparedArgs())
    const result = await (Effect.isEffect(rawResult)
      ? Effect.runPromise(rawResult as never)
      : rawResult)

    expect(seen).toEqual([0, 1])
    expect(result).toEqual({
      value: {
        model: 'test/model',
        messages: [
          { role: 'user', content: 'first' },
          { role: 'user', content: 'second' }
        ]
      }
    })
  })

  test('stops hook chain when control is returned', async () => {
    const seen: string[] = []
    const options = withPlugins(baseOptions(), [
      {
        hooks: {
          onTurnCompleted: async () => ({
            control: { type: 'finish' }
          })
        }
      },
      {
        hooks: {
          onTurnCompleted: async () => {
            seen.push('second')
          }
        }
      }
    ])

    const rawResult = options.hooks?.onTurnCompleted?.(turnCompletedArgs())
    const result = await (Effect.isEffect(rawResult)
      ? Effect.runPromise(rawResult as never)
      : rawResult)

    expect(seen).toEqual([])
    expect(result).toEqual({ control: { type: 'finish' } })
  })

  test('sets saveState', () => {
    const saveState = async () => {}
    const options = withPlugins(baseOptions(), [{ saveState }])

    expect(options.saveState).toBe(saveState)
  })
})
