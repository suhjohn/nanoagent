// @ts-nocheck
import { createInterface } from 'node:readline'

export function serializeJsonLine(value) {
  return `${JSON.stringify(value)}\n`
}

export function attachJsonlLineReader(input, onCommand) {
  const rl = createInterface({ input })
  rl.on('line', line => {
    if (!line.trim()) return
    onCommand(JSON.parse(line))
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
  const base = { id: command.id, type: 'response', command: command.type }
  try {
    return { ...base, success: true, data: await handle(command) }
  } catch (error) {
    return { ...base, success: false, error: errorMessage(error) }
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
