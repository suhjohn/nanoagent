import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'
import type {
  AgentCallToolArgs,
  AgentToolCallResponse,
  RunAgentOptions
} from '@nanoagent/kernel'
import {
  withApplyPatchTool,
  withCodingTools,
  withRequestPermissionsTool,
  withShellTool,
  withSnapshots,
  withToolConcurrency,
  withToolErrorBoundary,
  withToolPermission
} from './index.js'

type Context = {
  id: string
  group: string
}

const context: Context = { id: 'ctx', group: 'shared' }

function baseOptions(): RunAgentOptions<Context> {
  return {
    state: { context },
    maxTurns: 1,
    hooks: {
      onTurnPrepared: () => ({
        value: { model: 'test/model', messages: [] }
      })
    }
  }
}

type CallToolMiddleware = NonNullable<
  NonNullable<RunAgentOptions<Context>['middleware']>['callTool']
>[number]

async function withTempDir<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'nano-plugins-'))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function invokeToolCall(params: {
  middleware?: readonly CallToolMiddleware[]
  toolCall: AgentCallToolArgs<Context>['toolCall']
  next: (input: AgentCallToolArgs<Context>) => Promise<AgentToolCallResponse>
  context?: Context
}): Promise<AgentToolCallResponse> {
  const middleware = [...(params.middleware ?? [])]
  const dispatch = (
    index: number,
    input: AgentCallToolArgs<Context>
  ): Promise<AgentToolCallResponse> => {
    const current = middleware[index]
    if (!current) return params.next(input)
    return Promise.resolve(
      current({
        input,
        next: nextInput => dispatch(index + 1, nextInput)
      }) as AgentToolCallResponse | PromiseLike<AgentToolCallResponse>
    )
  }

  return dispatch(0, {
    context: params.context ?? context,
    messages: [],
    toolCall: params.toolCall,
    tools: {}
  })
}

describe('tool runtime plugins', () => {
  test('withCodingTools disables filesystem tools when only shell and patch stay enabled', async () => {
    await withTempDir(async root => {
      const configured = withCodingTools<Context>({
        cwd: root,
        enabled: ['shell', 'patch']
      })(baseOptions())

      expect(Object.keys(configured.tools ?? {})).toEqual([
        'bash',
        'apply_patch'
      ])
      expect(configured.tools?.read_file).toBeUndefined()
      expect(configured.tools?.write_file).toBeUndefined()
      expect(configured.tools?.edit_file).toBeUndefined()
      expect(configured.tools?.list_files).toBeUndefined()
      expect(configured.tools?.grep_files).toBeUndefined()
    })
  })

  test('withShellTool aborts and times out child process', async () => {
    await withTempDir(async root => {
      const configured = withShellTool<Context>({ cwd: root })(baseOptions())
      const shell = configured.tools?.shell

      expect(shell).toBeDefined()

      const controller = new AbortController()
      const aborted = shell!.execute!(
        { cmd: 'sleep', args: ['5'], timeoutMs: 1_000 },
        {
          toolCallId: 'shell-abort',
          messages: [],
          abortSignal: controller.signal,
          experimental_context: context
        }
      )
      controller.abort(new Error('stop'))

      await expect(aborted).resolves.toEqual({
        stdout: '',
        stderr: '',
        exitCode: null,
        signal: 'SIGTERM'
      })

      await expect(
        shell!.execute!(
          { cmd: 'sleep', args: ['5'], timeoutMs: 20 },
          {
            toolCallId: 'shell-timeout',
            messages: [],
            experimental_context: context
          }
        )
      ).resolves.toEqual({
        stdout: '',
        stderr: '',
        exitCode: null,
        signal: 'SIGTERM'
      })
    })
  })

  test('withApplyPatchTool applies add, update, and delete hunks', async () => {
    await withTempDir(async root => {
      await mkdir(path.join(root, 'nested'), { recursive: true })
      await writeFile(path.join(root, 'keep.txt'), 'old\nline\n', 'utf8')
      await writeFile(path.join(root, 'remove.txt'), 'delete me\n', 'utf8')

      const configured = withApplyPatchTool<Context>({ root })(baseOptions())
      const result = await configured.tools?.apply_patch?.execute!(
        {
          patch: `*** Begin Patch
*** Update File: keep.txt
@@
-old
+new
*** Delete File: remove.txt
*** Add File: nested/added.txt
+fresh
+content
*** End Patch`
        },
        { toolCallId: 'patch', messages: [], experimental_context: context }
      )

      expect(result).toEqual({
        changedFiles: ['keep.txt', 'remove.txt', 'nested/added.txt'],
        output: 'Applied patch to 3 file(s).'
      })
      await expect(readFile(path.join(root, 'keep.txt'), 'utf8')).resolves.toBe(
        'new\nline\n'
      )
      await expect(
        readFile(path.join(root, 'nested/added.txt'), 'utf8')
      ).resolves.toBe('fresh\ncontent\n')
      await expect(
        readFile(path.join(root, 'remove.txt'), 'utf8')
      ).rejects.toThrow()
    })
  })

  test('withToolPermission denies blocked call and passes allowed call', async () => {
    const calls: string[] = []
    const configured = withToolPermission<Context>(({ toolName }) =>
      toolName === 'blocked'
        ? { allow: false, reason: 'nope' }
        : { allow: true }
    )(baseOptions())

    const denied = await invokeToolCall({
      middleware: configured.middleware?.callTool,
      toolCall: {
        toolCallId: 'call-1',
        toolName: 'blocked',
        input: { path: 'secret.txt' }
      },
      next: async input => {
        calls.push(input.toolCall.toolName)
        return {
          toolCallId: input.toolCall.toolCallId,
          toolName: input.toolCall.toolName,
          input: input.toolCall.input,
          output: 'allowed'
        }
      }
    })

    const allowed = await invokeToolCall({
      middleware: configured.middleware?.callTool,
      toolCall: {
        toolCallId: 'call-2',
        toolName: 'open',
        input: { path: 'public.txt' }
      },
      next: async input => {
        calls.push(input.toolCall.toolName)
        return {
          toolCallId: input.toolCall.toolCallId,
          toolName: input.toolCall.toolName,
          input: input.toolCall.input,
          output: { ok: true }
        }
      }
    })

    expect(denied).toEqual({
      toolCallId: 'call-1',
      toolName: 'blocked',
      input: { path: 'secret.txt' },
      output: { denied: true, reason: 'nope' }
    })
    expect(allowed).toEqual({
      toolCallId: 'call-2',
      toolName: 'open',
      input: { path: 'public.txt' },
      output: { ok: true }
    })
    expect(calls).toEqual(['open'])
  })

  test('withToolErrorBoundary maps thrown errors', async () => {
    const seen: Array<{
      toolName: string
      input: unknown
      context: Context
    }> = []
    const configured = withToolErrorBoundary<Context>(async args => {
      seen.push({
        toolName: args.toolName,
        input: args.input,
        context: args.context
      })
      return {
        kind: 'mapped',
        message:
          args.error instanceof Error ? args.error.message : String(args.error)
      }
    })(baseOptions())

    const response = await invokeToolCall({
      middleware: configured.middleware?.callTool,
      toolCall: {
        toolCallId: 'call-1',
        toolName: 'crash',
        input: { path: 'bad.txt' }
      },
      next: async () => {
        throw new Error('boom')
      }
    })

    expect(response).toEqual({
      toolCallId: 'call-1',
      toolName: 'crash',
      input: { path: 'bad.txt' },
      error: { kind: 'mapped', message: 'boom' }
    })
    expect(seen).toEqual([
      {
        toolName: 'crash',
        input: { path: 'bad.txt' },
        context
      }
    ])
  })

  test('withToolConcurrency serializes calls with same queue key', async () => {
    const events: string[] = []
    let releaseFirst = () => {}
    let resolveFirstEntered = () => {}
    const firstEntered = new Promise<void>(resolve => {
      resolveFirstEntered = resolve
    })

    const configured = withToolConcurrency<Context>({
      key: ({ context }) => context.group
    })(baseOptions())

    const first = invokeToolCall({
      middleware: configured.middleware?.callTool,
      toolCall: {
        toolCallId: 'one',
        toolName: 'shared-tool',
        input: { step: 1 }
      },
      next: async input => {
        events.push(`enter:${input.toolCall.toolCallId}`)
        if (input.toolCall.toolCallId === 'one') {
          resolveFirstEntered()
          await new Promise<void>(resolve => {
            releaseFirst = resolve
          })
        }
        events.push(`exit:${input.toolCall.toolCallId}`)
        return {
          toolCallId: input.toolCall.toolCallId,
          toolName: input.toolCall.toolName,
          input: input.toolCall.input,
          output: input.toolCall.toolCallId
        }
      }
    })

    const second = invokeToolCall({
      middleware: configured.middleware?.callTool,
      toolCall: {
        toolCallId: 'two',
        toolName: 'shared-tool',
        input: { step: 2 }
      },
      next: async input => {
        events.push(`enter:${input.toolCall.toolCallId}`)
        events.push(`exit:${input.toolCall.toolCallId}`)
        return {
          toolCallId: input.toolCall.toolCallId,
          toolName: input.toolCall.toolName,
          input: input.toolCall.input,
          output: input.toolCall.toolCallId
        }
      }
    })

    await firstEntered
    expect(events).toEqual(['enter:one'])

    releaseFirst()

    await expect(first).resolves.toEqual({
      toolCallId: 'one',
      toolName: 'shared-tool',
      input: { step: 1 },
      output: 'one'
    })
    await expect(second).resolves.toEqual({
      toolCallId: 'two',
      toolName: 'shared-tool',
      input: { step: 2 },
      output: 'two'
    })
    expect(events).toEqual(['enter:one', 'exit:one', 'enter:two', 'exit:two'])
  })

  test('withSnapshots restores on error and attaches diff on success', async () => {
    const captures: Array<{
      toolName: string
      input: unknown
      context: Context
    }> = []
    const restores: Array<{
      snapshot: string
      error: string
    }> = []
    const diffs: Array<{
      snapshot: string
      output: unknown
    }> = []
    const configured = withSnapshots<Context, string>({
      capture: async args => {
        captures.push({
          toolName: args.toolName,
          input: args.input,
          context: args.context
        })
        return `snapshot:${args.context.id}:${args.toolName}`
      },
      restore: async args => {
        restores.push({
          snapshot: args.snapshot,
          error:
            args.error instanceof Error
              ? args.error.message
              : String(args.error)
        })
      },
      diff: async args => {
        diffs.push({
          snapshot: args.snapshot,
          output: args.output
        })
        return {
          changed: true,
          toolName: args.toolName
        }
      }
    })(baseOptions())

    const success = await invokeToolCall({
      middleware: configured.middleware?.callTool,
      toolCall: {
        toolCallId: 'write-1',
        toolName: 'write_file',
        input: { path: 'notes.txt' }
      },
      next: async input => ({
        toolCallId: input.toolCall.toolCallId,
        toolName: input.toolCall.toolName,
        input: input.toolCall.input,
        output: { bytes: 12 }
      })
    })

    const failure = await invokeToolCall({
      middleware: configured.middleware?.callTool,
      toolCall: {
        toolCallId: 'write-2',
        toolName: 'write_file',
        input: { path: 'broken.txt' }
      },
      next: async input => ({
        toolCallId: input.toolCall.toolCallId,
        toolName: input.toolCall.toolName,
        input: input.toolCall.input,
        error: new Error('broken')
      })
    })

    expect(success).toEqual({
      toolCallId: 'write-1',
      toolName: 'write_file',
      input: { path: 'notes.txt' },
      output: {
        value: { bytes: 12 },
        diff: { changed: true, toolName: 'write_file' }
      }
    })
    expect(failure).toMatchObject({
      toolCallId: 'write-2',
      toolName: 'write_file',
      input: { path: 'broken.txt' }
    })
    expect(failure.error).toBeInstanceOf(Error)
    expect((failure.error as Error).message).toBe('broken')
    expect(captures).toEqual([
      {
        toolName: 'write_file',
        input: { path: 'notes.txt' },
        context
      },
      {
        toolName: 'write_file',
        input: { path: 'broken.txt' },
        context
      }
    ])
    expect(restores).toEqual([
      {
        snapshot: 'snapshot:ctx:write_file',
        error: 'broken'
      }
    ])
    expect(diffs).toEqual([
      {
        snapshot: 'snapshot:ctx:write_file',
        output: { bytes: 12 }
      }
    ])
  })

  test('withRequestPermissionsTool forwards grant input and context', async () => {
    const grants: Array<{
      permission: string
      patterns: string[]
      reason?: string
      context: Context
    }> = []
    const configured = withRequestPermissionsTool<Context>({
      grant: input => {
        if (!input.context) throw new Error('missing context')
        grants.push({ ...input, context: input.context })
        return { granted: true }
      }
    })(baseOptions())

    const response = await configured.tools?.request_permissions?.execute!(
      {
        permission: 'filesystem',
        patterns: ['src/*.ts'],
        reason: 'read source'
      },
      { toolCallId: 'permission', messages: [], experimental_context: context }
    )

    expect(response).toEqual({ granted: true })
    expect(grants).toEqual([
      {
        permission: 'filesystem',
        patterns: ['src/*.ts'],
        reason: 'read source',
        context
      }
    ])
    expect(configured.tools?.request_permissions?.description).toContain(
      'Request additional permission'
    )
  })
})
