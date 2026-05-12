import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolSet<CONTEXT extends JsonLike> = NonNullable<
  RunAgentOptions<CONTEXT>['tools']
>

type Tool<CONTEXT extends JsonLike> = ToolSet<CONTEXT>[string]

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TodoPriority = 'high' | 'medium' | 'low'

export type Todo = {
  content: string
  status: TodoStatus
  priority: TodoPriority
}

export type TodoUpdateParams<CONTEXT> = {
  todos: Todo[]
  context?: CONTEXT
}

export type WithTodoWriteToolParams<CONTEXT extends JsonLike> = {
  update: (params: TodoUpdateParams<CONTEXT>) => unknown
  toolName?: string
}

const TODO_STATUSES: readonly TodoStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'cancelled'
]

const TODO_PRIORITIES: readonly TodoPriority[] = ['high', 'medium', 'low']

export function withTodoWriteTool<CONTEXT extends JsonLike>(
  params: WithTodoWriteToolParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  const toolName = params.toolName ?? 'todowrite'

  const tool: Tool<CONTEXT> = {
    description:
      'Replace current session todo list with complete ordered task state. Status must be pending, in_progress, completed, or cancelled.',
    inputSchema: objectSchema(
      {
        todos: {
          type: 'array',
          items: objectSchema(
            {
              content: { type: 'string' },
              status: { type: 'string', enum: TODO_STATUSES },
              priority: { type: 'string', enum: TODO_PRIORITIES }
            },
            ['content', 'status', 'priority']
          )
        }
      },
      ['todos']
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
      const todos = parseTodos(input)
      await params.update({ todos, context: options.experimental_context })
      const open = todos.filter(todo => todo.status !== 'completed').length
      return { title: `${open} todos`, todos }
    }
  } as unknown as Tool<CONTEXT>

  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [toolName]: tool }
  })
}

function parseTodos(input: unknown): Todo[] {
  const record = assertRecord(input, 'todowrite')
  if (!Array.isArray(record.todos)) {
    throw new Error('todos must be an array.')
  }
  return record.todos.map(parseTodo)
}

function parseTodo(raw: unknown): Todo {
  const item = assertRecord(raw, 'todo')
  const status = stringField(item, 'status')
  const priority = stringField(item, 'priority')
  if (!isTodoStatus(status)) {
    throw new Error(`Invalid todo status "${status}".`)
  }
  if (!isTodoPriority(priority)) {
    throw new Error(`Invalid todo priority "${priority}".`)
  }
  return { content: stringField(item, 'content'), status, priority }
}

function isTodoStatus(value: string): value is TodoStatus {
  return (TODO_STATUSES as readonly string[]).includes(value)
}

function isTodoPriority(value: string): value is TodoPriority {
  return (TODO_PRIORITIES as readonly string[]).includes(value)
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

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}
