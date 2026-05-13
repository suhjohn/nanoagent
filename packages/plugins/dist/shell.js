// Origin:
// - Codex: codex-rs/core/src/tools/handlers/shell_spec.rs, tools/runtimes/shell.rs
// - OpenCode: packages/opencode/src/tool/bash.ts, shell/shell.ts
// Behavior: bounded local command execution with explicit args/cwd/timeout and abort propagation.
import { spawn } from 'node:child_process'
const DEFAULT_TIMEOUT_MS = 30_000
const SHELL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    cmd: { type: 'string' },
    args: { type: 'array', items: { type: 'string' } },
    cwd: { type: 'string' },
    timeoutMs: { type: 'integer', minimum: 1 }
  },
  required: ['cmd'],
  additionalProperties: false
}
export function withShellTool(params = {}) {
  const toolName = params.toolName ?? 'shell'
  const tool = {
    description:
      'Run local command. Prefer focused commands with explicit cwd and finite timeout.',
    inputSchema: SHELL_INPUT_SCHEMA,
    execute: async (input, options) => {
      const args = parseShellInput(input, params)
      return (params.run ?? runShell)({
        ...args,
        signal: options.abortSignal,
        context: options.experimental_context
      })
    }
  }
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [toolName]: tool }
  })
}
function parseShellInput(input, params) {
  const record = assertRecord(input, 'shell')
  return {
    cmd: requireString(record, 'cmd'),
    args: optionalStringArray(record, 'args'),
    cwd: optionalString(record, 'cwd') ?? params.cwd,
    timeoutMs:
      optionalNumber(record, 'timeoutMs') ??
      params.timeoutMs ??
      DEFAULT_TIMEOUT_MS
  }
}
function runShell(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(args.cmd, args.args, {
      cwd: args.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdoutChunks = []
    const stderrChunks = []
    const abort = () => child.kill('SIGTERM')
    const timeout = setTimeout(abort, args.timeoutMs)
    args.signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => {
      clearTimeout(timeout)
      args.signal?.removeEventListener('abort', abort)
    }
    child.stdout.on('data', chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => stderrChunks.push(Buffer.from(chunk)))
    child.on('error', error => {
      cleanup()
      reject(error)
    })
    child.on('close', (exitCode, signal) => {
      cleanup()
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
        signal
      })
    })
  })
}
function assertRecord(input, name) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error(`${name} input must be an object.`)
  return input
}
function requireString(input, key) {
  const value = input[key]
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}
function optionalString(input, key) {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}
function optionalNumber(input, key) {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${key} must be a number.`)
}
function optionalStringArray(input, key) {
  const value = input[key]
  if (value === undefined) return []
  if (Array.isArray(value) && value.every(item => typeof item === 'string'))
    return value
  throw new Error(`${key} must be a string array.`)
}
