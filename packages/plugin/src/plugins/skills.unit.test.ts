import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import type { AgentTurnPreparedArgs, RunAgentOptions } from '@nanoagent/kernel'
import type { ModelMessage } from 'ai'
import { withPlugins } from '../index'
import { loadSkills, skillsPlugin } from './skills'

type Context = {
  count: number
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { force: true, recursive: true }))
  )
})

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'nano-skills-'))
  roots.push(root)
  return root
}

async function writeSkill(
  root: string,
  name: string,
  body: string,
  openAiYaml?: string
) {
  const skillDir = join(root, name)
  await mkdir(join(skillDir, 'agents'), { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), body)
  if (openAiYaml) {
    await writeFile(join(skillDir, 'agents', 'openai.yaml'), openAiYaml)
  }
  return join(skillDir, 'SKILL.md')
}

function turnPreparedArgs(): AgentTurnPreparedArgs<Context> {
  return {
    context: { count: 0 },
    createdAt: 'now',
    runId: 'run',
    state: {
      context: {
        count: 0
      },
      runId: 'run',
      revision: 0,
      status: {
        type: 'running',
        phase: 'turn_started'
      },
      turns: [],
      currentTurn: {
        turnId: 'turn',
        turn: 1,
        toolCalls: {
          pending: [],
          inFlight: [],
          completed: []
        }
      },
      updatedAt: 'now'
    },
    turn: {
      turnId: 'turn',
      turn: 1,
      toolCalls: {
        pending: [],
        inFlight: [],
        completed: []
      }
    }
  }
}

function baseOptions(messages: ModelMessage[]): RunAgentOptions<Context> {
  return {
    state: {
      context: {
        count: 0
      },
      runId: 'run'
    },
    maxTurns: 1,
    hooks: {
      onTurnPrepared: async () => ({
        value: {
          model: 'test/model',
          messages
        }
      })
    }
  }
}

async function prepareTurn(options: RunAgentOptions<Context>) {
  const rawResult = options.hooks.onTurnPrepared(turnPreparedArgs())
  return await (Effect.isEffect(rawResult)
    ? Effect.runPromise(rawResult)
    : rawResult)
}

describe('skillsPlugin', () => {
  test('loads skills from roots', async () => {
    const root = await tempRoot()
    const skillPath = await writeSkill(
      root,
      'alpha',
      [
        '---',
        'name: alpha',
        'description: Alpha skill',
        '---',
        '',
        'Use alpha.'
      ].join('\n')
    )

    const index = await loadSkills({ roots: [root] })

    expect(index.errors).toEqual([])
    expect(index.skills).toEqual([
      {
        name: 'alpha',
        description: 'Alpha skill',
        path: skillPath,
        allowImplicitInvocation: true
      }
    ])
  })

  test('loads default cwd skill roots and skips missing roots', async () => {
    const root = await tempRoot()
    const agentsSkillPath = await writeSkill(
      join(root, '.agents', 'skills'),
      'alpha',
      [
        '---',
        'name: alpha',
        'description: Alpha skill',
        '---',
        '',
        'Use alpha.'
      ].join('\n')
    )
    const claudeSkillPath = await writeSkill(
      join(root, '.claude', 'skills'),
      'beta',
      [
        '---',
        'name: beta',
        'description: Beta skill',
        '---',
        '',
        'Use beta.'
      ].join('\n')
    )

    const index = await loadSkills({
      cwd: root,
      home: join(root, 'missing-home'),
      codexHome: join(root, 'missing-codex')
    })

    expect(index.errors).toEqual([])
    expect(index.skills.map(skill => skill.path)).toEqual([
      agentsSkillPath,
      claudeSkillPath
    ])
  })

  test('injects catalog and explicit skill body before last user message', async () => {
    const root = await tempRoot()
    const skillPath = await writeSkill(
      root,
      'alpha',
      [
        '---',
        'name: alpha',
        'description: Alpha skill',
        '---',
        '',
        'Use alpha.'
      ].join('\n')
    )
    const options = withPlugins(
      baseOptions([{ role: 'user', content: 'please use $alpha' }]),
      [skillsPlugin({ roots: [root] })]
    )

    const result = await prepareTurn(options)
    const messages = result?.value?.messages ?? []

    expect(messages).toHaveLength(3)
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toContain('Alpha skill')
    expect(messages[1]).toEqual({
      role: 'user',
      content: `Skill alpha (${skillPath})\n\n---\nname: alpha\ndescription: Alpha skill\n---\n\nUse alpha.`
    })
    expect(messages[2]).toEqual({ role: 'user', content: 'please use $alpha' })
  })

  test('exposes implicit skill bodies through readSkill by default', async () => {
    const root = await tempRoot()
    const skillPath = await writeSkill(
      root,
      'alpha',
      [
        '---',
        'name: alpha',
        'description: Alpha skill',
        '---',
        '',
        'Use alpha.'
      ].join('\n')
    )
    const options = withPlugins(
      baseOptions([{ role: 'user', content: 'please do alpha work' }]),
      [skillsPlugin({ roots: [root] })]
    )

    const result = await prepareTurn(options)
    const messages = result?.value?.messages ?? []

    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toContain(
      `- alpha: Alpha skill (file: ${skillPath})`
    )
    expect(messages[1]).toEqual({
      role: 'user',
      content: 'please do alpha work'
    })
    await expect(
      options.tools?.readSkill?.execute?.({ name: 'alpha' }, {} as never)
    ).resolves.toEqual({
      name: 'alpha',
      path: skillPath,
      contents: '---\nname: alpha\ndescription: Alpha skill\n---\n\nUse alpha.'
    })
  })

  test('keeps explicit skill selectable when implicit invocation is disabled', async () => {
    const root = await tempRoot()
    await writeSkill(
      root,
      'alpha',
      [
        '---',
        'name: alpha',
        'description: Alpha skill',
        '---',
        '',
        'Use alpha.'
      ].join('\n'),
      'allow_implicit_invocation: false\n'
    )
    const options = withPlugins(
      baseOptions([{ role: 'user', content: 'please use $alpha' }]),
      [skillsPlugin({ roots: [root] })]
    )

    const result = await prepareTurn(options)
    const messages = result?.value?.messages ?? []

    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('user')
    expect(messages[0]?.content).toContain('Use alpha.')
  })

  test('does not select ambiguous duplicate names', async () => {
    const root = await tempRoot()
    await writeSkill(
      root,
      'one',
      [
        '---',
        'name: same',
        'description: First skill',
        '---',
        '',
        'Use first.'
      ].join('\n')
    )
    await writeSkill(
      root,
      'two',
      [
        '---',
        'name: same',
        'description: Second skill',
        '---',
        '',
        'Use second.'
      ].join('\n')
    )
    const options = withPlugins(
      baseOptions([{ role: 'user', content: 'please use $same' }]),
      [skillsPlugin({ roots: [root] })]
    )

    const result = await prepareTurn(options)
    const messages = result?.value?.messages ?? []

    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]).toEqual({ role: 'user', content: 'please use $same' })
    await expect(
      options.tools?.readSkill?.execute?.({ name: 'same' }, {} as never)
    ).rejects.toThrow('Skill name is ambiguous')
  })
})
