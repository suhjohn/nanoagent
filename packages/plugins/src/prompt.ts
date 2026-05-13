// Origin:
// - Codex: codex-rs/core/src/prompt_for_compact_command.md, project/user instructions assembly
// - Pi: packages/coding-agent/src/core/system-prompt.ts, resource-loader.ts
// Behavior: prompt middleware for system text, memory, skills, slash expansion, and compaction replacement.
import type {
  AgentHookResult,
  AgentTurnPreparedArgs,
  AgentTurnPreparedValue,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

type Awaitable<A> = A | Promise<A>

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
}

type SystemPromptContent<CONTEXT> =
  | string
  | ((context: CONTEXT) => Awaitable<string>)

type PromptLoadParams<CONTEXT> = {
  context: CONTEXT
  value: AgentTurnPreparedValue
}

type MemoryLoader<CONTEXT> = (args: {
  context: CONTEXT
}) => Awaitable<readonly string[]>

type PromptSkill = {
  name: string
  body: string
}

type SkillsLoader<CONTEXT> = (args: {
  context: CONTEXT
}) => Awaitable<readonly PromptSkill[]>

type CompactionParams<CONTEXT> = {
  shouldCompact: (args: PromptLoadParams<CONTEXT>) => Awaitable<boolean>
  compact: (args: PromptLoadParams<CONTEXT>) => Awaitable<Message[]>
}

export function withSystemPrompt<CONTEXT extends JsonLike>(
  content: SystemPromptContent<CONTEXT>
): AgentPlugin<CONTEXT> {
  return withTurnPrepared<CONTEXT>(async ({ args, value }) => {
    const text =
      typeof content === 'string'
        ? content
        : await content(args.context as CONTEXT)
    return { value: prependMessages(value, [message('system', text)]) }
  })
}

export function withPromptMessages<CONTEXT extends JsonLike>(
  load: (params: PromptLoadParams<CONTEXT>) => Awaitable<Message[]>
): AgentPlugin<CONTEXT> {
  return withTurnPrepared<CONTEXT>(async ({ args, value }) => ({
    value: appendMessages(
      value,
      await load({ context: args.context as CONTEXT, value })
    )
  }))
}

export function withMemory<CONTEXT extends JsonLike>(
  load: MemoryLoader<CONTEXT>
): AgentPlugin<CONTEXT> {
  return withTurnPrepared<CONTEXT>(async ({ args, value }) => {
    const memories = await load({ context: args.context as CONTEXT })
    if (!memories.length) return { value }
    const body = memories.map(item => `- ${item}`).join('\n')
    return {
      value: prependMessages(value, [message('system', `Memory:\n${body}`)])
    }
  })
}

export function withSkills<CONTEXT extends JsonLike>(
  load: SkillsLoader<CONTEXT>
): AgentPlugin<CONTEXT> {
  return withTurnPrepared<CONTEXT>(async ({ args, value }) => {
    const skills = await load({ context: args.context as CONTEXT })
    if (!skills.length) return { value }
    const body = skills
      .map(skill => `## ${skill.name}\n${skill.body}`)
      .join('\n\n')
    return {
      value: prependMessages(value, [
        message('system', `Available skills:\n${body}`)
      ])
    }
  })
}

export function withSlashCommands<CONTEXT extends JsonLike>(
  expand: (params: PromptLoadParams<CONTEXT>) => Awaitable<Message[]>
): AgentPlugin<CONTEXT> {
  return withTurnPrepared<CONTEXT>(async ({ args, value }) => ({
    value: appendMessages(
      value,
      await expand({ context: args.context as CONTEXT, value })
    )
  }))
}

export function withCompaction<CONTEXT extends JsonLike>(
  params: CompactionParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  return withTurnPrepared<CONTEXT>(async ({ args, value }) => {
    const context = args.context as CONTEXT
    if (!(await params.shouldCompact({ context, value }))) return { value }
    return {
      value: {
        ...value,
        messages: await params.compact({ context, value })
      } as AgentTurnPreparedValue
    }
  })
}

function withTurnPrepared<CONTEXT extends JsonLike>(
  transform: (params: {
    args: AgentTurnPreparedArgs<CONTEXT>
    value: AgentTurnPreparedValue
  }) => Awaitable<AgentHookResult<AgentTurnPreparedValue, CONTEXT>>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    hooks: {
      ...options.hooks,
      onTurnPrepared: async args => {
        const previous = (await options.hooks.onTurnPrepared(
          args
        )) as AgentHookResult<AgentTurnPreparedValue, CONTEXT>
        if (previous?.control) return previous
        const value = previous?.value
        if (!value) return previous
        const next = await transform({ args, value })
        return {
          context: next?.context ?? previous?.context,
          value: next?.value ?? value,
          control: next?.control
        }
      }
    }
  })
}

function message(role: Message['role'], content: unknown): Message {
  return { role, content }
}

function prependMessages(
  value: AgentTurnPreparedValue,
  messages: readonly Message[]
): AgentTurnPreparedValue {
  return {
    ...value,
    messages: [...messages, ...(value.messages ?? [])]
  } as AgentTurnPreparedValue
}

function appendMessages(
  value: AgentTurnPreparedValue,
  messages: readonly Message[]
): AgentTurnPreparedValue {
  return {
    ...value,
    messages: [...(value.messages ?? []), ...messages]
  } as AgentTurnPreparedValue
}
