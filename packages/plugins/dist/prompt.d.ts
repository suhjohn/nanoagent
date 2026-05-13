import type {
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
export declare function withSystemPrompt<CONTEXT extends JsonLike>(
  content: SystemPromptContent<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function withPromptMessages<CONTEXT extends JsonLike>(
  load: (params: PromptLoadParams<CONTEXT>) => Awaitable<Message[]>
): AgentPlugin<CONTEXT>
export declare function withMemory<CONTEXT extends JsonLike>(
  load: MemoryLoader<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function withSkills<CONTEXT extends JsonLike>(
  load: SkillsLoader<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function withSlashCommands<CONTEXT extends JsonLike>(
  expand: (params: PromptLoadParams<CONTEXT>) => Awaitable<Message[]>
): AgentPlugin<CONTEXT>
export declare function withCompaction<CONTEXT extends JsonLike>(
  params: CompactionParams<CONTEXT>
): AgentPlugin<CONTEXT>
export {}
