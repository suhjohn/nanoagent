// Origin:
// - Pi: packages/coding-agent/src/modes/rpc/rpc-mode.ts, rpc-types.ts
// - Codex: codex-rs/app-server-transport/src/transport/stdio.rs
// Behavior: JSONL request/response loop for embedding agent control over stdio-like streams.
import { createInterface } from 'node:readline'
export function serializeJsonLine(value) {
  return `${JSON.stringify(value)}\n`
}
export function attachJsonlLineReader(input, onCommand, onError) {
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
export function createRpcHandler(params) {
  return async command => {
    const response = await runCommand(params.handle, command)
    params.output.write(serializeJsonLine(response))
  }
}
async function runCommand(handle, command) {
  const base = {
    id: command.id,
    type: 'response',
    command: command.type
  }
  try {
    return { ...base, success: true, data: await handle(command) }
  } catch (error) {
    return { ...base, success: false, error: errorMessage(error) }
  }
}
function parseCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('JSONL RPC command must be an object.')
  }
  const command = input
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
  return command
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
function toError(error) {
  return error instanceof Error ? error : new Error(String(error))
}
