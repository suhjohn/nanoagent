import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type AgentCallModelArgs,
  type AgentCallModelResult,
  type AgentMiddleware,
  type AgentRunState,
  type AgentSaveState,
  type AgentStreamEvent,
  type JsonLike,
  runAgent
} from '../src/index'

type ChatMessage = {
  [key: string]: JsonLike
  role: 'user' | 'assistant'
  content: string
}

type ChatContext = {
  [key: string]: JsonLike
  messages: ChatMessage[]
  failBeforeModel: boolean
  failDuringModel: boolean
}

type Session = {
  state: AgentRunState<ChatContext>
}

const sessionDir = join(import.meta.dir, '.sessions')
const sessionId = process.env.SESSION_ID ?? 'demo'
const statePath = join(sessionDir, `${sessionId}.json`)
const eventsPath = join(sessionDir, `${sessionId}.jsonl`)
const model = process.env.MODEL ?? 'openai/gpt-5.5'
const saveState: AgentSaveState<ChatContext> = async ({ state, events }) => {
  await writeJsonAtomic(statePath, { state })
  await appendJsonl(eventsPath, events)
}

const command = process.argv[2]
const content = process.argv.slice(3).join(' ')

if (!command || !['fail', 'model-fail', 'reply', 'show'].includes(command)) {
  console.error(`usage:
  OPENAI_API_KEY=... bun packages/kernel/examples/json-session-recovery.ts fail "first message"
  OPENAI_API_KEY=... bun packages/kernel/examples/json-session-recovery.ts model-fail "first message"
  OPENAI_API_KEY=... bun packages/kernel/examples/json-session-recovery.ts reply "message after failure"
  bun packages/kernel/examples/json-session-recovery.ts show

files:
  ${statePath}
  ${eventsPath}`)
  process.exit(1)
}

await mkdir(sessionDir, { recursive: true })

if (command === 'show') {
  console.log(JSON.stringify(await loadSession(), null, 2))
  process.exit(0)
}

if (!content) {
  throw new Error(`${command} needs a message`)
}

const session = await loadSession()
const state = appendUserMessage({
  state: session?.state,
  content,
  failBeforeModel: command === 'fail',
  failDuringModel: command === 'model-fail'
})

const failModelOnce: AgentMiddleware<
  AgentCallModelArgs<ChatContext>,
  AgentCallModelResult
> = ({ input, next }) => {
  if (input.context.failDuringModel) {
    throw new Error('demo provider 500 from streamText')
  }

  return next(input)
}

try {
  for await (const event of runAgent({
    state,
    maxTurns: 1,
    saveState,
    middleware: {
      callModel: [failModelOnce]
    },
    hooks: {
      onTurnPrepared: ({ context }) => {
        if (context.failBeforeModel) {
          throw new Error('demo exception before model call')
        }

        return {
          value: {
            model,
            messages: [
              {
                role: 'system',
                content:
                  'You are testing durable recovery. Answer in one short sentence.'
              },
              ...context.messages
            ]
          }
        }
      },
      onTurnCompleted: ({ context, turn }) => {
        const messages: ChatMessage[] = context.messages.map(message => ({
          role: message.role,
          content: message.content
        }))
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: turn.modelResult?.text ?? ''
        }
        const nextContext: ChatContext = {
          messages: [...messages, assistantMessage],
          failBeforeModel: context.failBeforeModel,
          failDuringModel: context.failDuringModel
        }

        return {
          context: nextContext,
          control: { type: 'finish', reason: 'reply_saved' }
        }
      }
    }
  })) {
    console.log(event.type)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

async function loadSession(): Promise<Session | undefined> {
  try {
    return JSON.parse(await readFile(statePath, 'utf8')) as Session
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function appendUserMessage({
  state,
  content,
  failBeforeModel,
  failDuringModel
}: {
  state?: AgentRunState<ChatContext>
  content: string
  failBeforeModel: boolean
  failDuringModel: boolean
}): AgentRunState<ChatContext> | { runId: string; context: ChatContext } {
  const message = { role: 'user', content } satisfies ChatMessage

  if (!state) {
    return {
      runId: sessionId,
      context: {
        messages: [message],
        failBeforeModel,
        failDuringModel
      }
    }
  }

  if (state.status.type === 'completed') {
    return {
      runId: `${sessionId}-${Date.now()}`,
      context: {
        messages: [...state.context.messages, message],
        failBeforeModel,
        failDuringModel
      }
    }
  }

  return {
    ...state,
    context: {
      ...state.context,
      messages: [...state.context.messages, message],
      failBeforeModel,
      failDuringModel
    }
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`)
  await rename(tmp, path)
}

async function appendJsonl(path: string, events: AgentStreamEvent[]) {
  if (events.length === 0) return
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    events.map(event => JSON.stringify(event)).join('\n') + '\n',
    { flag: 'a' }
  )
}
