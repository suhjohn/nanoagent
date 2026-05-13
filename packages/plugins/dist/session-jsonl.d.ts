import type {
  AgentRunState,
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
export type JsonlMessageEntry = {
  id: string
  type: 'message'
  message: Message
}
export type JsonlCustomEntry = {
  id: string
  type: 'custom'
  message: Message
}
export type JsonlCompactionEntry = {
  id: string
  type: 'compaction'
  summary: string
}
export type JsonlBranchEntry = {
  id: string
  type: 'branch'
  summary: string
}
export type JsonlEntry =
  | JsonlMessageEntry
  | JsonlCustomEntry
  | JsonlCompactionEntry
  | JsonlBranchEntry
export type JsonlSessionRepo<CONTEXT extends JsonLike> = {
  entries: (sessionId: string) => Awaitable<readonly JsonlEntry[]>
  append: (sessionId: string, entries: readonly JsonlEntry[]) => Awaitable<void>
  saveRun?: (state: AgentRunState<CONTEXT>) => Awaitable<void>
}
export type JsonlSessionParams<CONTEXT extends JsonLike> = {
  sessionId: string
  repo: JsonlSessionRepo<CONTEXT>
}
export type FileJsonlSessionRepoParams = {
  dir: string
}
export declare function createFileJsonlSessionRepo<CONTEXT extends JsonLike>(
  params: FileJsonlSessionRepoParams
): JsonlSessionRepo<CONTEXT>
export declare function withJsonlSession<CONTEXT extends JsonLike>(
  params: JsonlSessionParams<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function projectEntries(
  entries: readonly JsonlEntry[]
): readonly Message[]
export {}
