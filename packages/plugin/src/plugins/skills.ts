import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type {
  AgentTurnPreparedArgs,
  AgentTurnPreparedValue,
  JsonLike,
  ReadonlyDeep
} from '@nanoagent/kernel'
import type { ModelMessage } from 'ai'
import type { AgentPlugin } from '../index'

export type SkillMetadata = {
  name: string
  description: string
  path: string
  allowImplicitInvocation: boolean
}

export type SkillLoadError = {
  path: string
  message: string
}

export type SkillIndex = {
  skills: SkillMetadata[]
  errors: SkillLoadError[]
}

export type SkillRootsOptions = {
  cwd?: string
  home?: string
  codexHome?: string
}

export type LoadSkillsOptions = {
  roots?: readonly string[]
  maxDepth?: number
} & SkillRootsOptions

export type SkillSelectionArgs<CONTEXT extends JsonLike> = {
  context: ReadonlyDeep<CONTEXT>
  turn: AgentTurnPreparedArgs<CONTEXT>['turn']
  messages: readonly ModelMessage[]
  skills: readonly SkillMetadata[]
}

export type SkillsPluginOptions<CONTEXT extends JsonLike> =
  LoadSkillsOptions & {
    select?: (
      args: SkillSelectionArgs<CONTEXT>
    ) => readonly SkillMetadata[] | Promise<readonly SkillMetadata[]>
  }

type ScalarMap = Record<string, string>

function isNotFound(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function stripQuotes(value: string) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseScalarYaml(text: string): ScalarMap {
  const values: ScalarMap = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separator = line.indexOf(':')
    if (separator === -1) {
      continue
    }

    values[line.slice(0, separator).trim()] = stripQuotes(
      line.slice(separator + 1)
    )
  }
  return values
}

function parseFrontmatter(body: string) {
  const lines = body.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return {}
  }

  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---'
  )
  return end === -1 ? {} : parseScalarYaml(lines.slice(1, end).join('\n'))
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback
  }
  return !['false', 'no', '0'].includes(value.trim().toLowerCase())
}

async function readOpenAiSkillPolicy(skillDir: string) {
  try {
    const policy = parseScalarYaml(
      await readFile(join(skillDir, 'agents', 'openai.yaml'), 'utf8')
    )
    return {
      allowImplicitInvocation: parseBoolean(
        policy.allow_implicit_invocation,
        true
      )
    }
  } catch (error) {
    if (isNotFound(error)) {
      return { allowImplicitInvocation: true }
    }
    throw error
  }
}

async function parseSkill(skillPath: string): Promise<SkillMetadata> {
  const body = await readFile(skillPath, 'utf8')
  const frontmatter = parseFrontmatter(body)
  const policy = await readOpenAiSkillPolicy(dirname(skillPath))
  const name = frontmatter.name || basename(dirname(skillPath))

  if (!frontmatter.description) {
    throw new Error('SKILL.md missing description frontmatter')
  }

  return {
    name,
    description: frontmatter.description,
    path: skillPath,
    allowImplicitInvocation: policy.allowImplicitInvocation
  }
}

async function collectSkillPaths(
  root: string,
  maxDepth: number,
  paths: Set<string>
) {
  const info = await stat(root)
  if (info.isFile()) {
    if (basename(root) === 'SKILL.md') {
      paths.add(resolve(root))
    }
    return
  }

  const directSkill = join(root, 'SKILL.md')
  try {
    if ((await stat(directSkill)).isFile()) {
      paths.add(resolve(directSkill))
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error
    }
  }

  if (maxDepth <= 0) {
    return
  }

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue
    }
    await collectSkillPaths(join(root, entry.name), maxDepth - 1, paths)
  }
}

function ancestors(cwd: string) {
  const dirs: string[] = []
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    dirs.push(dir)
    if (dirname(dir) === dir) {
      return dirs
    }
  }
}

export function skillRoots(options: SkillRootsOptions = {}) {
  const home = options.home ?? homedir()
  const codexHome =
    options.codexHome ?? process.env.CODEX_HOME ?? join(home, '.codex')
  return [
    ...ancestors(options.cwd ?? process.cwd()).flatMap(dir => [
      join(dir, '.agents', 'skills'),
      join(dir, '.claude', 'skills'),
      join(dir, '.codex', 'skills')
    ]),
    join(codexHome, 'skills'),
    join(home, '.agents', 'skills'),
    join(home, '.claude', 'skills')
  ].filter((root, index, roots) => roots.indexOf(root) === index)
}

export async function loadSkills(
  options: LoadSkillsOptions
): Promise<SkillIndex> {
  const skillPaths = new Set<string>()
  const errors: SkillLoadError[] = []

  for (const root of options.roots ?? skillRoots(options)) {
    try {
      await collectSkillPaths(resolve(root), options.maxDepth ?? 8, skillPaths)
    } catch (error) {
      if (isNotFound(error)) {
        continue
      }
      errors.push({
        path: root,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const skills: SkillMetadata[] = []
  for (const skillPath of [...skillPaths].sort()) {
    try {
      skills.push(await parseSkill(skillPath))
    } catch (error) {
      errors.push({
        path: skillPath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { skills, errors }
}

function textMessage(role: 'system' | 'user', content: string): ModelMessage {
  return { role, content }
}

function partText(part: unknown) {
  if (typeof part !== 'object' || part === null || !('text' in part)) {
    return ''
  }
  return typeof part.text === 'string' ? part.text : ''
}

function messageText(message: ModelMessage) {
  if (typeof message.content === 'string') {
    return message.content
  }
  if (Array.isArray(message.content)) {
    return message.content.map(partText).filter(Boolean).join('\n')
  }
  return ''
}

function mentionPath(rawPath: string) {
  return rawPath.startsWith('skill://')
    ? rawPath.slice('skill://'.length)
    : rawPath
}

function selectExplicitSkills(
  skills: readonly SkillMetadata[],
  messages: readonly ModelMessage[]
) {
  const names = new Map<string, SkillMetadata[]>()
  for (const skill of skills) {
    names.set(skill.name, [...(names.get(skill.name) ?? []), skill])
  }

  const selected = new Map<string, SkillMetadata>()
  const text = messages
    .filter(message => message.role === 'user')
    .map(messageText)
    .join('\n')

  const linked = /\[\$([A-Za-z0-9_:-]+)\]\(([^)]+)\)/g
  for (const match of text.matchAll(linked)) {
    const path = match[2] ? resolve(mentionPath(match[2])) : ''
    const byPath = skills.find(skill => skill.path === path)
    const byName = names.get(match[1] ?? '')
    const skill = byName?.[0]
    if (byPath) {
      selected.set(byPath.path, byPath)
    } else if (byName?.length === 1 && skill) {
      selected.set(skill.path, skill)
    }
  }

  const mentions =
    /(^|[^A-Za-z0-9_:-])\$([A-Za-z0-9_:-]+)(?=$|[^A-Za-z0-9_:-])/g
  for (const match of text.matchAll(mentions)) {
    const byName = names.get(match[2] ?? '')
    const skill = byName?.[0]
    if (byName?.length === 1 && skill) {
      selected.set(skill.path, skill)
    }
  }

  return [...selected.values()]
}

function skillCatalogMessage(skills: readonly SkillMetadata[]) {
  const implicitSkills = skills.filter(skill => skill.allowImplicitInvocation)
  if (!implicitSkills.length) {
    return undefined
  }

  const entries = implicitSkills
    .map(skill => `- ${skill.name}: ${skill.description} (file: ${skill.path})`)
    .join('\n')

  return textMessage(
    'system',
    [
      '## Skills',
      'Skills are local instruction files. Use listed skill when task matches description or user names it explicitly.',
      '',
      '### Available skills',
      entries,
      '',
      '### Usage',
      'When applying skill, follow its SKILL.md instructions exactly. Explicit `$name` mentions select matching skill body for current turn.'
    ].join('\n')
  )
}

function insertBeforeLastUser(
  messages: readonly ModelMessage[],
  injected: readonly ModelMessage[]
) {
  if (!injected.length) {
    return [...messages]
  }

  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      return [
        ...messages.slice(0, index),
        ...injected,
        ...messages.slice(index)
      ]
    }
  }

  return [...messages, ...injected]
}

async function applySkillsToValue<CONTEXT extends JsonLike>(
  options: SkillsPluginOptions<CONTEXT>,
  args: AgentTurnPreparedArgs<CONTEXT>
): Promise<AgentTurnPreparedValue | undefined> {
  const current = args.turn.modelArgs
  if (!current?.messages) {
    return undefined
  }

  const index = await loadSkills(options)
  const selected = options.select
    ? await options.select({
        context: args.context,
        turn: args.turn,
        messages: current.messages,
        skills: index.skills
      })
    : selectExplicitSkills(index.skills, current.messages)

  const catalog = skillCatalogMessage(index.skills)
  const skillBodies = await Promise.all(
    selected.map(async skill =>
      textMessage(
        'user',
        `Skill ${skill.name} (${skill.path})\n\n${await readFile(skill.path, 'utf8')}`
      )
    )
  )

  const messages = insertBeforeLastUser(
    catalog ? [catalog, ...current.messages] : current.messages,
    skillBodies
  )

  return {
    ...current,
    messages
  }
}

export function skillsPlugin<CONTEXT extends JsonLike>(
  options: SkillsPluginOptions<CONTEXT>
): AgentPlugin<CONTEXT> {
  return {
    name: 'skills',
    hooks: {
      onTurnPrepared: async args => {
        const value = await applySkillsToValue(options, args)
        return value ? { value } : {}
      }
    }
  }
}
