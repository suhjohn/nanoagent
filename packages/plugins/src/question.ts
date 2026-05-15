// Origin:
// - Codex: codex-rs/core/src/tools/handlers/request_user_input_spec.rs
// - OpenCode: packages/opencode/src/question/index.ts
// Behavior: Codex request_user_input tool schema, root-thread/mode checks, and blocking response shape.
import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolSet<CONTEXT extends JsonLike> = NonNullable<
  RunAgentOptions<CONTEXT>['tools']
>

type Tool<CONTEXT extends JsonLike> = ToolSet<CONTEXT>[string]

type Awaitable<A> = A | Promise<A>

export type QuestionOption = {
  label: string
  description: string
}

export type Question = {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: QuestionOption[]
}

export type QuestionAnswer = {
  answers: string[]
}

export type QuestionResponse = {
  answers: Record<string, QuestionAnswer>
}

export type QuestionAskParams<CONTEXT> = {
  input: { questions: Question[] }
  context?: CONTEXT
  signal?: AbortSignal
  toolCallId: string
  turnId: string
}

export type WithQuestionToolParams<CONTEXT extends JsonLike> = {
  ask: (
    params: QuestionAskParams<CONTEXT>
  ) => Awaitable<QuestionResponse | undefined>
  availableModes?: readonly string[]
  mode?: (params: { context?: CONTEXT }) => string | undefined
  isRootThread?: (params: { context?: CONTEXT }) => boolean
  toolName?: string
}

export function withQuestionTool<CONTEXT extends JsonLike>(
  params: WithQuestionToolParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  const toolName = params.toolName ?? 'request_user_input'
  const turnIds = new Map<string, string>()

  const tool: Tool<CONTEXT> = {
    description: requestUserInputDescription(params.availableModes ?? ['Plan']),
    inputSchema: objectSchema(
      {
        questions: {
          type: 'array',
          description: 'Questions to show the user. Prefer 1 and do not exceed 3',
          items: objectSchema(
            {
              id: {
                type: 'string',
                description:
                  'Stable identifier for mapping answers (snake_case).'
              },
              header: {
                type: 'string',
                description:
                  'Short header label shown in the UI (12 or fewer chars).'
              },
              question: {
                type: 'string',
                description: 'Single-sentence prompt shown to the user.'
              },
              options: {
                type: 'array',
                description:
                  'Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an "Other" option in this list; the client will add a free-form "Other" option automatically.',
                items: objectSchema(
                  {
                    label: {
                      type: 'string',
                      description: 'User-facing label (1-5 words).'
                    },
                    description: {
                      type: 'string',
                      description:
                        'One short sentence explaining impact/tradeoff if selected.'
                    }
                  },
                  ['label', 'description']
                )
              }
            },
            ['id', 'header', 'question', 'options']
          )
        }
      },
      ['questions']
    ),
    execute: async (
      input: unknown,
      options: {
        toolCallId: string
        messages: unknown[]
        abortSignal?: AbortSignal
        experimental_context?: CONTEXT
      }
    ) => {
      const context = options.experimental_context
      if (params.isRootThread?.({ context }) === false) {
        throw new Error('request_user_input can only be used by the root thread')
      }

      const availableModes = params.availableModes ?? ['Plan']
      const mode = params.mode?.({ context })
      if (mode !== undefined && !availableModes.includes(mode)) {
        throw new Error(`request_user_input is unavailable in ${mode} mode`)
      }

      const turnId = turnIds.get(options.toolCallId) ?? options.toolCallId
      const response = await params.ask({
        input: parseQuestionInput(input),
        context,
        signal: options.abortSignal,
        toolCallId: options.toolCallId,
        turnId
      })
      if (!response) {
        throw new Error(
          'request_user_input was cancelled before receiving a response'
        )
      }
      return response
    }
  } as unknown as Tool<CONTEXT>

  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [toolName]: tool },
    hooks: {
      ...options.hooks,
      onToolCallStarted: args => {
        if (args.toolName === toolName) {
          turnIds.set(args.toolCallId, args.turn.turnId)
        }
        return options.hooks.onToolCallStarted?.(args)
      },
      onToolCallCompleted: args => {
        if (args.toolName === toolName) {
          turnIds.delete(args.toolCallId)
        }
        return options.hooks.onToolCallCompleted?.(args)
      }
    }
  })
}

function parseQuestionInput(input: unknown): { questions: Question[] } {
  const record = assertRecord(input, 'question')
  const rawQuestions = record.questions
  if (!Array.isArray(rawQuestions)) throw new Error('questions must be an array.')
  return { questions: rawQuestions.map(parseQuestion) }
}

function parseQuestion(raw: unknown): Question {
  const question = assertRecord(raw, 'question item')
  const options = parseOptions(question.options)
  return {
    id: stringField(question, 'id'),
    header: stringField(question, 'header'),
    question: stringField(question, 'question'),
    isOther: true,
    isSecret: booleanField(question, 'isSecret', false),
    options
  }
}

function parseOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      'request_user_input requires non-empty options for every question'
    )
  }
  return raw.map(option => {
    const item = assertRecord(option, 'question option')
    return {
      label: stringField(item, 'label'),
      description: stringField(item, 'description')
    }
  })
}

function requestUserInputDescription(availableModes: readonly string[]) {
  return `Request user input for one to three short questions and wait for the response. This tool is only available in ${formatAllowedModes(availableModes)}.`
}

function formatAllowedModes(availableModes: readonly string[]) {
  if (availableModes.length === 0) return 'no modes'
  if (availableModes.length === 1) return `${availableModes[0]} mode`
  if (availableModes.length === 2) {
    return `${availableModes[0]} or ${availableModes[1]} mode`
  }
  return `modes: ${availableModes.join(',')}`
}

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = []
) {
  return { type: 'object', properties, required, additionalProperties: false }
}

function assertRecord(input: unknown, name: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${name} input must be an object.`)
  }
  return input as Record<string, unknown>
}

function stringField(
  input: Record<string, unknown>,
  key: string,
  required?: true
): string
function stringField(
  input: Record<string, unknown>,
  key: string,
  required: false
): string | undefined
function stringField(
  input: Record<string, unknown>,
  key: string,
  required = true
) {
  const value = input[key]
  if (typeof value === 'string') return value
  if (!required && value === undefined) return undefined
  throw new Error(`${key} must be a string.`)
}

function booleanField(
  input: Record<string, unknown>,
  key: string,
  fallback: boolean
) {
  const value = input[key]
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  throw new Error(`${key} must be a boolean.`)
}
