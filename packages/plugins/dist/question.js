export function withQuestionTool(params) {
  const toolName = params.toolName ?? 'request_user_input'
  const tool = {
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
    execute: (input, options) =>
      params.ask({
        input: parseQuestionInput(input),
        context: options.experimental_context,
        signal: options.abortSignal,
        toolCallId: options.toolCallId
      })
  }
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [toolName]: tool }
  })
}
function parseQuestionInput(input) {
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
function parseQuestion(raw) {
  const question = assertRecord(raw, 'question item')
  return {
    id: stringField(question, 'id'),
    header: stringField(question, 'header'),
    question: stringField(question, 'question'),
    options: parseOptions(question.options)
  }
}
function parseOptions(raw) {
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
function objectSchema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
function assertRecord(input, name) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${name} input must be an object.`)
  }
  return input
}
function stringField(input, key, required = true) {
  const value = input[key]
  if (typeof value === 'string') return value
  if (!required && value === undefined) return undefined
  throw new Error(`${key} must be a string.`)
}
