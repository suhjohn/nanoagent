import type { JsonLike } from '@nanoagent/kernel'
import type { RunAgentOptions } from '@nanoagent/kernel'
type Awaitable<A> = A | Promise<A>
type AgentPlugin<CONTEXT extends JsonLike = JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
type ToolSet<CONTEXT extends JsonLike = JsonLike> = NonNullable<
  RunAgentOptions<CONTEXT>['tools']
>
type JsonSchema =
  | { type: 'string'; description?: string; enum?: readonly string[] }
  | { type: 'number'; description?: string; minimum?: number; maximum?: number }
  | {
      type: 'integer'
      description?: string
      minimum?: number
      maximum?: number
    }
  | { type: 'boolean'; description?: string }
  | {
      type: 'array'
      description?: string
      items: JsonSchema
      minItems?: number
      maxItems?: number
    }
  | {
      type: 'object'
      description?: string
      properties: Record<string, JsonSchema>
      required?: readonly string[]
      additionalProperties?: boolean
    }
type ToolExecuteOptions<CONTEXT extends JsonLike = JsonLike> = {
  toolCallId: string
  messages: unknown[]
  abortSignal?: AbortSignal
  experimental_context?: CONTEXT
}
type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
}
export type ExternalHookEvent =
  | {
      type: 'UserPromptSubmit'
      prompt: unknown
    }
  | {
      type: 'PreToolUse'
      toolName: string
      input: unknown
    }
  | {
      type: 'PostToolUse'
      toolName: string
      input: unknown
      result: unknown
    }
export declare function withExternalHooks<CONTEXT extends JsonLike>(
  run: (args: { event: ExternalHookEvent; context: CONTEXT }) => Awaitable<void>
): AgentPlugin<CONTEXT>
