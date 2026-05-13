import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'
import { runAgent } from '../../kernel/dist/index.js'
import type {
  AgentCallModelResult,
  AgentModelArgs,
  AgentRunState,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'
import {
  createFileJsonlSessionRepo,
  withJsonlSession,
  withPlanTool,
  withProjectContext,
  withPromptTemplates,
  withQuestionTool,
  withTodoWriteTool,
  withToolErrorBoundary
} from './index.js'

type Context = {
  input: string
}

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

describe('agent plugin integration', () => {
  test('prompt, session, and tool plugins work across real agent turns', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'agent-plugins-'))
    const sessionDir = path.join(root, 'sessions')
    const templateDir = path.join(root, 'commands')
    await mkdir(templateDir, { recursive: true })
    await writeFile(path.join(root, 'AGENTS.md'), 'Project rule: be exact.')
    await writeFile(
      path.join(templateDir, 'fix.md'),
      ['---', 'description: Fix file.', '---', 'Fix $1 with $2.'].join('\n')
    )

    const repo = createFileJsonlSessionRepo<Context>({ dir: sessionDir })
    await repo.append('chat', [
      {
        id: 'prior',
        type: 'message',
        message: { role: 'user', content: 'prior request' }
      }
    ])

    const plans: unknown[] = []
    const todos: unknown[] = []
    const answers: unknown[] = []
    const modelArgs: AgentModelArgs[] = []
    let savedState: AgentRunState<Context> | undefined
    const plugin = compose<Context>(
      withProjectContext({ cwd: root }),
      withPromptTemplates({
        dirs: [templateDir],
        getInput: context => context.input
      }),
      withJsonlSession({ sessionId: 'chat', repo }),
      withPlanTool({
        update: params => {
          plans.push(params.input)
          return { ok: true }
        }
      }),
      withTodoWriteTool({
        update: params => {
          todos.push(params.todos)
        }
      }),
      withQuestionTool({
        ask: params => {
          answers.push(params.input)
          return { answers: { choice: 'A' } }
        }
      }),
      withToolErrorBoundary(error => error.error)
    )

    const configured = plugin({
      state: { context: { input: '/fix src/app.ts failing-test' } },
      maxTurns: 4,
      saveState: args => {
        savedState = args.state
      },
      hooks: {
        onTurnPrepared: args => ({
          value: {
            model: 'test/model',
            messages: [
              {
                role: 'user',
                content: `turn ${args.turn.turn}: ${args.context.input}`
              }
            ]
          }
        })
      },
      middleware: {
        callModel: [
          async ({ input }) => {
            modelArgs.push(input.args)
            return scriptedModelResult({
              args: input.args,
              text: input.turn.turn === 1 ? 'collecting facts' : 'final answer',
              toolCalls:
                input.turn.turn === 1
                  ? [
                      {
                        toolCallId: 'plan',
                        toolName: 'update_plan',
                        input: {
                          plan: [
                            { step: 'Inspect', status: 'completed' },
                            { step: 'Patch', status: 'in_progress' }
                          ]
                        }
                      },
                      {
                        toolCallId: 'todo',
                        toolName: 'todowrite',
                        input: {
                          todos: [
                            {
                              content: 'Patch failing test',
                              status: 'in_progress',
                              priority: 'high'
                            }
                          ]
                        }
                      },
                      {
                        toolCallId: 'question',
                        toolName: 'request_user_input',
                        input: {
                          questions: [
                            {
                              id: 'choice',
                              header: 'Choice',
                              question: 'Pick fix?',
                              options: [
                                { label: 'A', description: 'Small fix.' },
                                { label: 'B', description: 'Broad fix.' }
                              ]
                            }
                          ]
                        }
                      }
                    ]
                  : []
            })
          }
        ]
      }
    })

    const events = []
    for await (const event of runAgent(configured)) events.push(event)

    const secondTurnMessages = JSON.stringify(modelArgs[1]?.messages)
    expect(events.map(event => event.type)).toContain('run_completed')
    expect(modelArgs).toHaveLength(2)
    expect(JSON.stringify(modelArgs[0]?.system)).toContain(
      'Project rule: be exact.'
    )
    expect(JSON.stringify(modelArgs[0]?.messages)).toContain(
      'Fix src/app.ts with failing-test.'
    )
    expect(secondTurnMessages).toContain('prior request')
    expect(secondTurnMessages).toContain('collecting facts')
    expect(plans).toEqual([
      {
        plan: [
          { step: 'Inspect', status: 'completed' },
          { step: 'Patch', status: 'in_progress' }
        ]
      }
    ])
    expect(todos).toEqual([
      [
        {
          content: 'Patch failing test',
          status: 'in_progress',
          priority: 'high'
        }
      ]
    ])
    expect(answers).toHaveLength(1)
    expect(savedState?.status.type).toBe('completed')
    expect(
      await readFile(path.join(sessionDir, 'chat.jsonl'), 'utf8')
    ).toContain('final answer')
  })
})

function compose<CONTEXT extends JsonLike>(
  ...plugins: AgentPlugin<CONTEXT>[]
): AgentPlugin<CONTEXT> {
  return options => plugins.reduce((next, plugin) => plugin(next), options)
}

function scriptedModelResult(params: {
  args: AgentModelArgs
  text: string
  toolCalls: AgentCallModelResult['pendingToolCalls']
}): AgentCallModelResult {
  return {
    args: params.args,
    duration: 1,
    pendingToolCalls: params.toolCalls,
    rawResult: {} as AgentCallModelResult['rawResult'],
    result: {
      finishReason: params.toolCalls.length ? 'tool-calls' : 'stop',
      text: params.text,
      response: {
        id: `response-${params.text}`,
        modelId: params.args.model,
        timestamp: new Date(0),
        messages: [{ role: 'assistant', content: params.text }]
      },
      totalUsage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
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
