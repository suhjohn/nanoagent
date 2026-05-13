// Origin:
// - Codex: codex-rs/core/src/tools/handlers/request_user_input_spec.rs
// - OpenCode: packages/opencode/src/question/index.ts
// Behavior: blocking user question tool with 1-3 questions and explicit choice options.
import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolSet<CONTEXT extends JsonLike> = NonNullable<
  RunAgentOptions<CONTEXT>['tools']
>

type Tool<CONTEXT extends JsonLike> = ToolSet<CONTEXT>[string]

export type QuestionOption = {
  label: string
  description: string
}

export type Question = {
  id: string
  header: string
  question: string
  options: QuestionOption[]
}

export type QuestionAskParams<CONTEXT> = {
  input: { questions: Question[] }
  context?: CONTEXT
  signal?: AbortSignal
  toolCallId: string
}

export type WithQuestionToolParams<CONTEXT extends JsonLike> = {
  ask: (params: QuestionAskParams<CONTEXT>) => unknown
  toolName?: string
}

export function withQuestionTool<CONTEXT extends JsonLike>(
  params: WithQuestionToolParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  const toolName = params.toolName ?? 'request_user_input'

  const tool: Tool<CONTEXT> = {
    description:
      'Request user input for one to three short questions and wait for the response.',
    inputSchema: objectSchema(
      {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: objectSchema(
            {
              id: {
                type: 'string',
                description: 'Stable snake_case key used in answer map.'
              },
              header: {
                type: 'string',
                description: 'Short UI label.'
              },
              question: {
                type: 'string',
                description: 'Single concrete question.'
              },
              options: {
                type: 'array',
                minItems: 2,
                maxItems: 3,
                items: objectSchema(
                  {
                    label: { type: 'string' },
                    description: { type: 'string' }
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
    execute: (
      input: unknown,
      options: {
        toolCallId: string
        messages: unknown[]
        abortSignal?: AbortSignal
        experimental_context?: CONTEXT
      }
    ) =>
      params.ask({
        input: parseQuestionInput(input),
        context: options.experimental_context,
        signal: options.abortSignal,
        toolCallId: options.toolCallId
      })
  } as unknown as Tool<CONTEXT>

  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [toolName]: tool }
  })
}

function parseQuestionInput(input: unknown): { questions: Question[] } {
  const record = assertRecord(input, 'question')
  const rawQuestions = record.questions
  if (!Array.isArray(rawQuestions) || rawQuestions.length < 1) {
    throw new Error('questions must contain at least one question.')
  }
  if (rawQuestions.length > 3) {
    throw new Error('questions must contain at most three questions.')
  }
  return { questions: rawQuestions.map(parseQuestion) }
}

function parseQuestion(raw: unknown): Question {
  const question = assertRecord(raw, 'question item')
  return {
    id: stringField(question, 'id'),
    header: stringField(question, 'header'),
    question: stringField(question, 'question'),
    options: parseOptions(question.options)
  }
}

function parseOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) throw new Error('options must be an array.')
  if (raw.length < 2 || raw.length > 3) {
    throw new Error('options must contain two or three choices.')
  }
  return raw.map(option => {
    const item = assertRecord(option, 'question option')
    return {
      label: stringField(item, 'label'),
      description: stringField(item, 'description')
    }
  })
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
