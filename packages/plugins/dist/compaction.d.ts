import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type Awaitable<A> = A | Promise<A>
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
}
type MessageSplit = {
  head: readonly Message[]
  tail: readonly Message[]
}
export type CompactionTrigger = 'auto' | 'manual' | 'overflow'
export type CompactionSummaryEntry = {
  summary: string
  tokensBefore: number
  tokensAfter: number
  trigger: CompactionTrigger
  createdAt: string
  readFiles: string[]
  modifiedFiles: string[]
}
export type CompactionStore<CONTEXT extends JsonLike> = {
  latest(context: CONTEXT): Awaitable<CompactionSummaryEntry | undefined>
  save(context: CONTEXT, entry: CompactionSummaryEntry): Awaitable<void>
}
export type CompactionSummarizer<CONTEXT extends JsonLike> = (args: {
  context: CONTEXT
  messages: readonly Message[]
  previousSummary?: string
  prompt: string
  trigger: CompactionTrigger
}) => Awaitable<string>
export type CompactHookOutcome =
  | {
      continue: true
      systemMessage?: string
    }
  | {
      continue: false
      stopReason?: string
      systemMessage?: string
    }
export type CompactHook<CONTEXT extends JsonLike> = (args: {
  context: CONTEXT
  trigger: CompactionTrigger
  model: string
  turnId: string
  messages: readonly Message[]
}) => Awaitable<CompactHookOutcome | void>
export declare function estimateMessageTokens(
  messages: readonly Message[]
): number
export declare function withOpenCodeCompaction<
  CONTEXT extends JsonLike
>(params: {
  store: CompactionStore<CONTEXT>
  maxTokens: number
  reservedTokens?: number
  preserveRecentTokens?: number
  tailTurns?: number
  trigger?: CompactionTrigger
  context?: (args: { context: CONTEXT }) => Awaitable<readonly string[]>
  summarize: CompactionSummarizer<CONTEXT>
}): AgentPlugin<CONTEXT>
export declare function withCodexCompaction<CONTEXT extends JsonLike>(params: {
  maxTokens: number
  trigger?: CompactionTrigger
  store?: CompactionStore<CONTEXT>
  compactPrompt?: string
  preserveUserTokens?: number
  initialContext?: (args: { context: CONTEXT }) => Awaitable<readonly Message[]>
  preCompact?: CompactHook<CONTEXT>
  postCompact?: CompactHook<CONTEXT>
  summarize: CompactionSummarizer<CONTEXT>
}): AgentPlugin<CONTEXT>
export declare const withContextCompaction: typeof withOpenCodeCompaction
export declare function openCodeCompactionPrompt(input: {
  previousSummary?: string
  context?: readonly string[]
}): string
export declare function selectOpenCodeCompactionMessages(params: {
  messages: readonly Message[]
  preserveRecentTokens: number
  tailTurns: number
}): MessageSplit
export declare function codexSummaryText(summary: string): string
export {}
