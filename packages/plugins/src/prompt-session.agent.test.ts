import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  MockLanguageModelV3,
  simulateReadableStream
} from '../../kernel/node_modules/ai/dist/test/index.js'
import { runAgent } from '../../kernel/dist/index.js'
import {
  createFileJsonlSessionRepo,
  createMemoryGoalStore,
  withGoalTools,
  withJsonlSession,
  withProjectContext,
  withPromptTemplates,
  withSystemPrompt,
  withTurnQueue
} from './index.js'

type Context = { id: string }

const usage = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: undefined,
    cacheWrite: undefined
  },
  outputTokens: {
    total: 0,
    text: 0,
    reasoning: undefined
  }
}

async function collect<EVENT>(events: AsyncIterable<EVENT>): Promise<EVENT[]> {
  const collected: EVENT[] = []
  for await (const event of events) collected.push(event)
  return collected
}

async function withTempDir<T>(
  prefix: string,
  run: (dir: string) => Promise<T>
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function makeModel(turns: readonly { stream: ReadableStream<any> }[]) {
  let index = 0
  return new MockLanguageModelV3({
    doStream: async () => turns[index++]!
  })
}

function textTurn(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: text },
        { type: 'text-end', id: 'text-1' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: undefined },
          logprobs: undefined,
          usage
        }
      ]
    })
  }
}

function toolTurn(toolCall: {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}) {
  const input = JSON.stringify(toolCall.input)
  return {
    stream: simulateReadableStream({
      chunks: [
        {
          type: 'tool-input-start',
          id: toolCall.toolCallId,
          toolName: toolCall.toolName,
          dynamic: false
        },
        {
          type: 'tool-input-delta',
          id: toolCall.toolCallId,
          delta: input
        },
        {
          type: 'tool-input-end',
          id: toolCall.toolCallId
        },
        {
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: undefined },
          logprobs: undefined,
          usage
        }
      ]
    })
  }
}

function promptDump(call: { prompt?: unknown }) {
  return JSON.stringify(call.prompt ?? [])
}

describe('prompt/session agents', () => {
  test('withPromptTemplates caches template content across turns', async () => {
    await withTempDir('nano-plugins-templates-', async dir => {
      const templates = path.join(dir, 'templates')
      const templateFile = path.join(templates, 'repeat.md')
      await mkdir(templates, { recursive: true })
      await writeFile(templateFile, 'Remember $1\n')

      const inputs = ['/repeat Alice', '/repeat Bob']
      const model = makeModel([textTurn('first'), textTurn('second')])

      await collect(
        runAgent(
          withPromptTemplates<Context>({
            dirs: [templates],
            getInput: () => inputs.shift()
          })({
            state: { context: { id: 'ctx' } },
            modelProviders: { test: () => model as never },
            maxTurns: 2,
            hooks: {
              onTurnPrepared: () => ({
                value: {
                  model: 'test/model',
                  messages: [{ role: 'user', content: 'start' }]
                }
              }),
              onTurnCompleted: async ({ turn }) => {
                if (turn.turn !== 1) return
                await writeFile(templateFile, 'Forget $1\n')
                return { control: { type: 'continue' } }
              }
            }
          })
        )
      )

      expect(model.doStreamCalls).toHaveLength(2)
      expect(promptDump(model.doStreamCalls[0]!)).toContain('Remember Alice')
      expect(promptDump(model.doStreamCalls[1]!)).toContain('Remember Bob')
      expect(promptDump(model.doStreamCalls[1]!)).not.toContain('Forget Bob')
    })
  })

  test('withProjectContext keeps cached context while system prompt follows context', async () => {
    await withTempDir('nano-plugins-project-', async dir => {
      const workspace = path.join(dir, 'workspace')
      const cwd = path.join(workspace, 'app')
      const agentDir = path.join(dir, 'agent')
      const rootAgents = path.join(workspace, 'AGENTS.md')
      const agentClaude = path.join(agentDir, 'CLAUDE.md')

      await mkdir(cwd, { recursive: true })
      await mkdir(agentDir, { recursive: true })
      await writeFile(rootAgents, 'root v1\n')
      await writeFile(agentClaude, 'agent v1\n')

      const model = makeModel([textTurn('first'), textTurn('second')])

      await collect(
        runAgent(
          withProjectContext<Context>({ cwd, agentDir })(
            withSystemPrompt<Context>(context => `system:${context.id}`)({
              state: { context: { id: 'turn-1' } },
              modelProviders: { test: () => model as never },
              maxTurns: 2,
              hooks: {
                onTurnPrepared: () => ({
                  value: {
                    model: 'test/model',
                    messages: [{ role: 'user', content: 'start' }]
                  }
                }),
                onTurnCompleted: async ({ turn }) => {
                  if (turn.turn !== 1) return
                  await writeFile(rootAgents, 'root v2\n')
                  await writeFile(agentClaude, 'agent v2\n')
                  return {
                    context: { id: 'turn-2' },
                    control: { type: 'continue' }
                  }
                }
              }
            })
          )
        )
      )

      expect(model.doStreamCalls).toHaveLength(2)
      const firstPrompt = promptDump(model.doStreamCalls[0]!)
      const secondPrompt = promptDump(model.doStreamCalls[1]!)

      expect(firstPrompt).toContain('root v1')
      expect(firstPrompt).toContain('agent v1')
      expect(firstPrompt).toContain('system:turn-1')
      expect(secondPrompt).toContain('root v1')
      expect(secondPrompt).toContain('agent v1')
      expect(secondPrompt).toContain('system:turn-2')
      expect(secondPrompt).not.toContain('root v2')
      expect(secondPrompt).not.toContain('agent v2')
    })
  })

  test('withJsonlSession rehydrates file repo and appends assistant turns', async () => {
    await withTempDir('nano-plugins-session-', async dir => {
      const repo = createFileJsonlSessionRepo<Context>({ dir })
      await repo.append('session-1', [
        {
          id: 'seed-1',
          type: 'message',
          message: { role: 'user', content: 'seed user' }
        }
      ])

      const firstModel = makeModel([textTurn('first assistant')])
      await collect(
        runAgent(
          withJsonlSession<Context>({
            sessionId: 'session-1',
            repo
          })({
            state: { context: { id: 'ctx' } },
            modelProviders: { test: () => firstModel as never },
            maxTurns: 1,
            hooks: {
              onTurnPrepared: () => ({
                value: {
                  model: 'test/model',
                  messages: [{ role: 'user', content: 'turn input' }]
                }
              })
            }
          })
        )
      )

      const secondModel = makeModel([textTurn('second assistant')])
      await collect(
        runAgent(
          withJsonlSession<Context>({
            sessionId: 'session-1',
            repo
          })({
            state: { context: { id: 'ctx' } },
            modelProviders: { test: () => secondModel as never },
            maxTurns: 1,
            hooks: {
              onTurnPrepared: () => ({
                value: {
                  model: 'test/model',
                  messages: [{ role: 'user', content: 'turn input' }]
                }
              })
            }
          })
        )
      )

      expect(firstModel.doStreamCalls).toHaveLength(1)
      expect(secondModel.doStreamCalls).toHaveLength(1)
      expect(promptDump(firstModel.doStreamCalls[0]!)).toContain('seed user')
      expect(promptDump(secondModel.doStreamCalls[0]!)).toContain(
        'first assistant'
      )

      const raw = await readFile(path.join(dir, 'session-1.jsonl'), 'utf8')
      const entries = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
      expect(entries.map((entry: { type: string }) => entry.type)).toEqual([
        'message',
        'custom',
        'custom'
      ])
      expect(entries[1]).toMatchObject({
        type: 'custom',
        message: { role: 'assistant', content: 'first assistant' }
      })
      expect(entries[2]).toMatchObject({
        type: 'custom',
        message: { role: 'assistant', content: 'second assistant' }
      })
    })
  })

  test('withTurnQueue drains queued messages turn by turn', async () => {
    const steering = ['steer-1', 'steer-2']
    const followUp = ['follow-1', 'follow-2']
    const steeringShifts: number[] = []
    const followUpShifts: number[] = []
    const model = makeModel([textTurn('first'), textTurn('second')])

    await collect(
      runAgent(
        withTurnQueue<Context>({
          mode: 'one-at-a-time',
          store: {
            steering: async () => steering,
            shiftSteering: async (_context, count) => {
              steeringShifts.push(count)
              steering.splice(0, count)
            },
            followUp: async () => followUp,
            shiftFollowUp: async (_context, count) => {
              followUpShifts.push(count)
              followUp.splice(0, count)
            }
          }
        })({
          state: { context: { id: 'ctx' } },
          modelProviders: { test: () => model as never },
          maxTurns: 2,
          hooks: {
            onTurnPrepared: () => ({
              value: {
                model: 'test/model',
                messages: [{ role: 'user', content: 'turn input' }]
              }
            }),
            onTurnCompleted: ({ turn }) =>
              turn.turn === 1 ? { control: { type: 'continue' } } : undefined
          }
        })
      )
    )

    expect(model.doStreamCalls).toHaveLength(2)
    expect(promptDump(model.doStreamCalls[0]!)).toContain('steer-1')
    expect(promptDump(model.doStreamCalls[0]!)).toContain('follow-1')
    expect(promptDump(model.doStreamCalls[1]!)).toContain('steer-2')
    expect(promptDump(model.doStreamCalls[1]!)).toContain('follow-2')
    expect(steering).toEqual([])
    expect(followUp).toEqual([])
    expect(steeringShifts).toEqual([1, 1])
    expect(followUpShifts).toEqual([1, 1])
  })

  test('withGoalTools creates goal on first turn and completes it on second', async () => {
    const store = createMemoryGoalStore<Context>({
      id: () => 'goal-1',
      now: () => '2026-05-12T00:00:00.000Z'
    })
    const configured = withGoalTools<Context>({ store })({
      state: { context: { id: 'ctx' } },
      maxTurns: 2,
      hooks: {
        onTurnPrepared: () => ({
          value: {
            model: 'test/model',
            messages: [{ role: 'user', content: 'start goal work' }]
          }
        })
      }
    })

    const firstTurn = (await configured.hooks.onTurnPrepared({
      context: { id: 'ctx' },
      state: { context: { id: 'ctx' } },
      turn: { turnId: 'turn-1', turn: 1, toolCalls: [] },
      createdAt: '2026-05-12T00:00:00.000Z'
    } as never)) as { value?: unknown }
    await configured.tools!.create_goal!.execute!(
      { objective: 'ship docs', token_budget: 5 },
      { toolCallId: 'goal-create', messages: [] } as never
    )
    const secondTurn = (await configured.hooks.onTurnPrepared({
      context: { id: 'ctx' },
      state: { context: { id: 'ctx' } },
      turn: { turnId: 'turn-2', turn: 2, toolCalls: [] },
      createdAt: '2026-05-12T00:00:00.000Z'
    } as never)) as { value?: unknown }
    await configured.tools!.update_goal!.execute!({ status: 'complete' }, {
      toolCallId: 'goal-complete',
      messages: []
    } as never)

    expect(JSON.stringify(firstTurn.value ?? {})).not.toContain(
      '<goal_context>'
    )
    const secondPrompt = JSON.stringify(secondTurn.value ?? {})
    expect(secondPrompt).toContain('<goal_context>')
    expect(secondPrompt).toContain(
      'Continue working toward the active thread goal.'
    )
    expect(secondPrompt).toContain('ship docs')
    expect(secondPrompt).toContain('Tokens remaining: 5')

    expect(await store.get()).toMatchObject({
      goalId: 'goal-1',
      objective: 'ship docs',
      status: 'complete',
      tokenBudget: 5,
      tokensUsed: 0,
      timeUsedSeconds: 0
    })
  })
})
