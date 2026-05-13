// Origin:
// - Pi: packages/coding-agent/src/modes/rpc/rpc-mode.ts, rpc-types.ts
// - Codex: codex-rs/app-server-transport/src/transport/stdio.rs
// Behavior: JSONL request/response loop for embedding agent control over stdio-like streams.
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

type Awaitable<A> = A | Promise<A>

export type JsonlRpcCommand = {
  id?: string | number
  type: string
  [key: string]: unknown
}

export type JsonlRpcResponse =
  | {
      id?: string | number
      type: 'response'
      command: string
      success: true
      data: unknown
    }
  | {
      id?: string | number
      type: 'response'
      command: string
      success: false
      error: string
    }

export type JsonlRpcHandlerParams = {
  handle: (command: JsonlRpcCommand) => Awaitable<unknown>
  output: Pick<Writable, 'write'>
}

export function serializeJsonLine(value: unknown) {
  return `${JSON.stringify(value)}\n`
}

export function attachJsonlLineReader(
  input: Readable,
  onCommand: (command: JsonlRpcCommand) => void,
  onError?: (error: Error) => void
) {
  const rl = createInterface({ input })
  rl.on('line', line => {
    if (!line.trim()) return
    try {
      onCommand(parseCommand(JSON.parse(line)))
    } catch (error) {
      onError?.(toError(error))
    }
  })
  return () => rl.close()
}

export function createRpcHandler(params: JsonlRpcHandlerParams) {
  return async (command: JsonlRpcCommand) => {
    const response = await runCommand(params.handle, command)
    params.output.write(serializeJsonLine(response))
  }
}

async function runCommand(
  handle: JsonlRpcHandlerParams['handle'],
  command: JsonlRpcCommand
): Promise<JsonlRpcResponse> {
  const base = {
    id: command.id,
    type: 'response' as const,
    command: command.type
  }
  try {
    return { ...base, success: true, data: await handle(command) }
  } catch (error) {
    return { ...base, success: false, error: errorMessage(error) }
  }
}

function parseCommand(input: unknown): JsonlRpcCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('JSONL RPC command must be an object.')
  }
  const command = input as Record<string, unknown>
  if (typeof command.type !== 'string') {
    throw new Error('JSONL RPC command type must be a string.')
  }
  if (
    command.id !== undefined &&
    typeof command.id !== 'string' &&
    typeof command.id !== 'number'
  ) {
    throw new Error('JSONL RPC command id must be a string or number.')
  }
  return command as JsonlRpcCommand
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
