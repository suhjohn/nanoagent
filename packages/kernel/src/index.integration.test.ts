import { describe, expect, test } from 'bun:test'
import { openai } from '@ai-sdk/openai'
import {
  generateObject,
  jsonSchema,
  type ModelMessage,
  tool,
  type ToolSet
} from 'ai'
import {
  type AgentSaveState,
  type AgentPhaseEvent,
  type AgentHooks,
  type AgentRunState,
  type AgentStreamEvent,
  type Turn,
  type JsonLike,
  runAgent
} from './index'

type IntegrationContext = {
  [key: string]: JsonLike
  approvedToolCallIds: string[]
  finalText: string
  pausedToolCallId: string | null
  toolCallsCompleted: string[]
}

type ApprovalDecision = {
  decision: 'allow' | 'ask' | 'deny'
  reason: string
}

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

function numberInput(input: unknown) {
  if (typeof input !== 'object' || input === null) {
    return null
  }
  const values = input as Record<string, unknown>
  return typeof values.a === 'number' && typeof values.b === 'number'
    ? { a: values.a, b: values.b }
    : null
}

const openaiTest = process.env.OPENAI_API_KEY ? test : test.skip

describe('runAgent OpenAI integration', () => {
  openaiTest(
    'runs policy-model approval, pause/resume, tools, and continuation',
    async () => {
      const model = process.env.OPENAI_TEST_MODEL ?? 'openai/gpt-5.4-nano'

      // This array represents caller-owned session memory. Core has no session
      // primitive; each run reads this array during onTurnPrepared, and the
      // client appends assistant/tool messages when turns complete.
      const sessionMessages: ModelMessage[] = [
        {
          role: 'system',
          content:
            'You are testing an agent runtime. Follow exact output instructions.'
        },
        {
          role: 'user',
          content:
            'Call both tools before answering. Call AddNumbers with {"a":2,"b":3} and MultiplyNumbers with {"a":10,"b":5}. After both tool results are returned, reply exactly: sum=5 product=50'
        }
      ]

      // The main agent gets two normal AI SDK tools. MultiplyNumbers is
      // intentionally "large" by policy because a is 10.
      const tools = {
        AddNumbers: tool({
          description: 'Add two numbers and return the numeric sum.',
          inputSchema: jsonSchema<{ a: number; b: number }>({
            type: 'object',
            additionalProperties: false,
            properties: {
              a: { type: 'number' },
              b: { type: 'number' }
            },
            required: ['a', 'b']
          }),
          execute: ({ a, b }) => a + b
        }),
        MultiplyNumbers: tool({
          description: 'Multiply two numbers and return the numeric product.',
          inputSchema: jsonSchema<{ a: number; b: number }>({
            type: 'object',
            additionalProperties: false,
            properties: {
              a: { type: 'number' },
              b: { type: 'number' }
            },
            required: ['a', 'b']
          }),
          execute: ({ a, b }) => a * b
        })
      } satisfies ToolSet

      const persistTurn = (turn: Turn) => {
        const modelResult = turn.modelResult
        if (!modelResult) return
        sessionMessages.push(...modelResult.response.messages)
        if (turn.toolCalls.completed.length > 0) {
          sessionMessages.push({
            role: 'tool',
            content: turn.toolCalls.completed.map(toolCall => ({
              type: 'tool-result',
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              output:
                'error' in toolCall
                  ? {
                      type: 'json',
                      value: { error: String(toolCall.error) }
                    }
                  : {
                      type: 'json',
                      value: toolCall.output as JsonLike
                    }
            }))
          } as ModelMessage)
        }
      }

      const hooks: AgentHooks<IntegrationContext> = {
        onTurnPrepared: () => ({
          value: {
            model,
            messages: [...sessionMessages]
          }
        }),

        // Extract SDK-shaped `text` from rawResult (not in canonical
        // AgentModelResult) and stash on caller context for later hooks.
        onModelCompleted: async ({ context, rawResult }) => {
          const text = (await rawResult.text).trim()
          if (!text) return
          return {
            context: {
              ...context,
              approvedToolCallIds: [...context.approvedToolCallIds],
              toolCallsCompleted: [...context.toolCallsCompleted],
              finalText: text
            }
          }
        },

        // This is an LLM-based approval policy. The main model requested the
        // tool call; a separate policy model decides whether that call should
        // run, be denied, or pause for human approval.
        onToolCallStarted: async ({ context, input, toolCallId, toolName }) => {
          if (context.approvedToolCallIds.includes(toolCallId)) {
            return
          }
          if (toolName !== 'MultiplyNumbers') {
            return
          }

          const numericInput = numberInput(input)
          if (!numericInput) {
            return
          }

          const { object: decision } = await generateObject({
            model: openai(
              (
                process.env.OPENAI_POLICY_TEST_MODEL ??
                process.env.OPENAI_TEST_MODEL ??
                'openai/gpt-5.4-nano'
              ).replace(/^openai\//, '')
            ),
            schema: jsonSchema<ApprovalDecision>({
              type: 'object',
              additionalProperties: false,
              properties: {
                decision: {
                  type: 'string',
                  enum: ['allow', 'ask', 'deny']
                },
                reason: { type: 'string' }
              },
              required: ['decision', 'reason']
            }),
            prompt: `
Decide whether this tool call needs user approval.

Policy:
- If toolName is MultiplyNumbers and a >= 10 or b >= 10, return decision "ask".
- Otherwise return decision "allow".
- Do not return "deny" for this test.

Tool name: ${toolName}
Input: ${JSON.stringify(numericInput)}
            `.trim()
          })

          if (decision.decision === 'ask') {
            return {
              context: {
                ...context,
                approvedToolCallIds: [...context.approvedToolCallIds],
                toolCallsCompleted: [...context.toolCallsCompleted],
                pausedToolCallId: toolCallId
              },
              control: {
                type: 'pause',
                reason: 'approval_required',
                metadata: {
                  decisionReason: decision.reason,
                  toolCallId,
                  toolName
                }
              }
            }
          }

          if (decision.decision === 'deny') {
            return {
              value: {
                type: 'skip',
                result: {
                  toolCallId,
                  toolName,
                  input,
                  error: decision.reason
                }
              }
            }
          }
        },

        onToolCallCompleted: ({ context, toolName }) => ({
          context: {
            ...context,
            approvedToolCallIds: [...context.approvedToolCallIds],
            toolCallsCompleted: [...context.toolCallsCompleted, toolName]
          }
        }),

        // This is where the test client persists produced messages back into
        // caller-owned session memory. The next turn/run reads them from
        // onTurnPrepared. finalText is already on context from
        // onModelCompleted.
        onTurnCompleted: ({ turn }) => {
          persistTurn(turn)
        }
      }

      // Run 1: model asks for two tools. The policy model pauses on the large
      // MultiplyNumbers call before any tools execute.
      const firstRecorder = makeSnapshotRecorder<IntegrationContext>()
      const pausedEvents = await collect<AgentStreamEvent>(
        runAgent({
          saveState: firstRecorder.saveState,
          state: {
            context: {
              approvedToolCallIds: [],
              finalText: '',
              pausedToolCallId: null,
              toolCallsCompleted: []
            }
          },
          tools,
          maxTurns: 3,
          hooks
        })
      )
      const pausedSnapshot = firstRecorder.latest()

      expect(pausedEvents.map(event => event.type)).toContain('stream_part')
      expect(pausedEvents.at(-1)?.type).toBe('pause')
      const pausedStatus = pausedSnapshot?.status
      expect(pausedStatus?.type).toBe('paused')
      if (pausedStatus?.type === 'paused') {
        expect(pausedStatus.reason).toBe('approval_required')
        expect(pausedStatus.metadata).toMatchObject({
          toolCallId: pausedSnapshot?.context.pausedToolCallId,
          toolName: 'MultiplyNumbers'
        })
      }
      expect(pausedSnapshot?.currentTurn?.toolCalls.pending).toHaveLength(2)
      expect(sessionMessages).toHaveLength(2)

      // Run 2: caller approves exactly the paused toolCallId and resumes from
      // the durable snapshot. Core clears pause, re-enters the phase, executes
      // both tools, persists messages, and continues to the final answer.
      const resumedRecorder = makeSnapshotRecorder<IntegrationContext>()
      const resumedEvents = await collect<AgentStreamEvent>(
        runAgent({
          saveState: resumedRecorder.saveState,
          maxTurns: 3,
          hooks,
          state: {
            ...pausedSnapshot!,
            context: {
              ...pausedSnapshot!.context,
              approvedToolCallIds: [
                ...pausedSnapshot!.context.approvedToolCallIds,
                pausedSnapshot!.context.pausedToolCallId!
              ]
            }
          },
          tools
        })
      )
      const completedSnapshot = resumedRecorder.latest()

      expect(resumedEvents.map(event => event.type)).toContain('run_completed')
      expect(completedSnapshot?.status.type).toBe('completed')
      expect(completedSnapshot?.context.toolCallsCompleted.sort()).toEqual([
        'AddNumbers',
        'MultiplyNumbers'
      ])
      expect(completedSnapshot?.context.finalText).toBe('sum=5 product=50')
      expect(completedSnapshot?.turns).toHaveLength(2)
      expect(sessionMessages.length).toBeGreaterThan(2)

      // Run 3: a brand new run continues with caller-owned session memory.
      sessionMessages.push({
        role: 'user',
        content:
          'Using the existing conversation context, reply exactly: session-continuation-ok'
      })
      const followUpRecorder = makeSnapshotRecorder<IntegrationContext>()
      const followUpEvents = await collect<AgentStreamEvent>(
        runAgent({
          saveState: followUpRecorder.saveState,
          state: {
            context: {
              approvedToolCallIds: [],
              finalText: '',
              pausedToolCallId: null,
              toolCallsCompleted: []
            }
          },
          tools,
          maxTurns: 1,
          hooks
        })
      )
      const followUpSnapshot = followUpRecorder.latest()

      expect(followUpEvents.map(event => event.type)).toContain('run_completed')
      expect(followUpSnapshot?.status.type).toBe('completed')
      expect(followUpSnapshot?.context.finalText).toBe(
        'session-continuation-ok'
      )
    },
    30_000
  )
})
