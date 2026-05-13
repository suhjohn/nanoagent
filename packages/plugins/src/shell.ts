// Origin:
// - Codex: codex-rs/core/src/tools/handlers/shell_spec.rs, tools/runtimes/shell.rs
// - OpenCode: packages/opencode/src/tool/bash.ts, shell/shell.ts
// Behavior: bounded local command execution with explicit args/cwd/timeout and abort propagation.
import { spawn } from 'node:child_process'
import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type Awaitable<A> = A | Promise<A>

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type ToolSet<CONTEXT extends JsonLike> = NonNullable<
  RunAgentOptions<CONTEXT>['tools']
>

type Tool<CONTEXT extends JsonLike> = ToolSet<CONTEXT>[string]

type ToolExecuteOptions<CONTEXT> = {
  abortSignal?: AbortSignal
  experimental_context?: CONTEXT
}

export type ShellRunInput<CONTEXT extends JsonLike> = {
  cmd: string
  args: string[]
  cwd?: string
  timeoutMs: number
  signal?: AbortSignal
  context?: CONTEXT
}

export type ShellRunResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
}

export type ShellPluginParams<CONTEXT extends JsonLike> = {
  cwd?: string
  timeoutMs?: number
  toolName?: string
  run?: (args: ShellRunInput<CONTEXT>) => Awaitable<ShellRunResult>
}

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

export function withShellTool<CONTEXT extends JsonLike>(
  params: ShellPluginParams<CONTEXT> = {}
): AgentPlugin<CONTEXT> {
  const toolName = params.toolName ?? 'shell'
  const tool: Tool<CONTEXT> = {
    description:
      'Run local command. Prefer focused commands with explicit cwd and finite timeout.',
    inputSchema: SHELL_INPUT_SCHEMA,
    execute: async (input: unknown, options: ToolExecuteOptions<CONTEXT>) => {
      const args = parseShellInput(input, params)
      return (params.run ?? runShell)({
        ...args,
        signal: options.abortSignal,
        context: options.experimental_context
      })
    }
  } as unknown as Tool<CONTEXT>
  return options => ({
    ...options,
    tools: { ...(options.tools ?? {}), [toolName]: tool }
  })
}

function parseShellInput<CONTEXT extends JsonLike>(
  input: unknown,
  params: ShellPluginParams<CONTEXT>
): Omit<ShellRunInput<CONTEXT>, 'signal' | 'context'> {
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

function runShell<CONTEXT extends JsonLike>(
  args: ShellRunInput<CONTEXT>
): Promise<ShellRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(args.cmd, args.args, {
      cwd: args.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
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

function assertRecord(input: unknown, name: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error(`${name} input must be an object.`)
  return input as Record<string, unknown>
}

function requireString(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}

function optionalNumber(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${key} must be a number.`)
}

function optionalStringArray(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (value === undefined) return []
  if (Array.isArray(value) && value.every(item => typeof item === 'string'))
    return value
  throw new Error(`${key} must be a string array.`)
}
