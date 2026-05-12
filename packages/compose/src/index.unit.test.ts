import { describe, expect, test } from 'bun:test'
import type {
  AgentCallToolArgs,
  AgentMiddleware,
  AgentToolCallResponse,
  AgentTurnCompletedArgs,
  RunAgentOptions
} from '@nanoagent/kernel'
import {
  withHooks,
  withMiddleware,
  withModelProviders,
  withPlugins,
  withSaveState,
  withTools
} from './index'

type Context = {
  count: number
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

describe('withPlugins', () => {
  test('applies plugins in order', async () => {
    const order: string[] = []

    await withPlugins(baseOptions(), [
      options => {
        order.push('a')
        return options
      },
      async options => {
        order.push('b')
        return options
      }
    ])

    expect(order).toEqual(['a', 'b'])
  })
})

describe('withTools', () => {
  test('merges tools without dropping existing tools', async () => {
    const one = { description: 'one', inputSchema: {} } as never
    const two = { description: 'two', inputSchema: {} } as never
    const options = await withPlugins(baseOptions(), [
      withTools({ one }),
      withTools({ two })
    ])

    expect(Object.keys(options.tools ?? {})).toEqual(['one', 'two'])
  })
})

describe('withModelProviders', () => {
  test('merges providers', async () => {
    const first = (() => null) as never
    const second = (() => null) as never
    const options = await withPlugins(baseOptions(), [
      withModelProviders({ first }),
      withModelProviders({ second })
    ])

    expect(Object.keys(options.modelProviders ?? {})).toEqual([
      'first',
      'second'
    ])
  })
})

describe('withMiddleware', () => {
  test('appends middleware arrays', async () => {
    const first: AgentMiddleware<
      AgentCallToolArgs<Context>,
      AgentToolCallResponse
    > = async ({ next, input }) => next(input)
    const second: AgentMiddleware<
      AgentCallToolArgs<Context>,
      AgentToolCallResponse
    > = async ({ next, input }) => next(input)
    const options = await withPlugins(baseOptions(), [
      withMiddleware({ callTool: [first] }),
      withMiddleware({ callTool: [second] })
    ])

    expect(options.middleware?.callTool).toEqual([first, second])
  })
})

describe('withHooks', () => {
  test('chains hooks and forwards updated context', async () => {
    const seen: number[] = []
    const options = await withPlugins(baseOptions(), [
      withHooks({
        onTurnCompleted: async () => ({
          context: {
            count: 1
          }
        })
      }),
      withHooks({
        onTurnCompleted: async ({ context }) => {
          seen.push(context.count)
          return {
            context: {
              count: context.count + 1
            }
          }
        }
      })
    ])

    const result = await options.hooks.onTurnCompleted?.(turnCompletedArgs())

    expect(seen).toEqual([1])
    expect(result).toEqual({
      context: {
        count: 2
      }
    })
  })

  test('stops hook chain when control is returned', async () => {
    const seen: string[] = []
    const options = await withPlugins(baseOptions(), [
      withHooks({
        onTurnCompleted: async () => ({
          control: {
            type: 'finish'
          }
        })
      }),
      withHooks({
        onTurnCompleted: async () => {
          seen.push('second')
        }
      })
    ])

    const result = await options.hooks.onTurnCompleted?.(turnCompletedArgs())

    expect(seen).toEqual([])
    expect(result).toEqual({
      control: {
        type: 'finish'
      }
    })
  })
})

describe('withSaveState', () => {
  test('sets saveState', async () => {
    const saveState = async () => {}
    const options = await withPlugins(baseOptions(), [withSaveState(saveState)])

    expect(options.saveState).toBe(saveState)
  })
})
