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
type PluginTools<CONTEXT extends JsonLike> = NonNullable<
  AgentPlugin<CONTEXT>['tools']
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
      'A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path.',
      '',
      '### Available skills',
      entries,
      '',
      '### How to use skills',
      '- Discovery: The list above is the skills available in this session (name + description + file path).',
      '- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill description shown above, use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.',
      '- Missing/blocked: If a named skill is not in the list or its path cannot be read, say so briefly and continue with the best fallback.',
      '- How to use a skill: after deciding to use a skill, read its `SKILL.md` completely before taking task actions. Use `readSkill` with the listed name or path unless the skill body was already injected for an explicit `$SkillName` mention.',
      '- Context hygiene: read only referenced files needed for the task.'
    ].join('\n')
  )
}

async function readSelectedSkill<CONTEXT extends JsonLike>(
  options: SkillsPluginOptions<CONTEXT>,
  input: unknown
) {
  if (!isRecord(input)) {
    throw new Error('readSkill input must be an object.')
  }

  const name = typeof input.name === 'string' ? input.name : undefined
  const rawPath = typeof input.path === 'string' ? input.path : undefined
  if (!name && !rawPath) {
    throw new Error('readSkill requires name or path.')
  }

  const index = await loadSkills(options)
  const skills = index.skills.filter(skill => skill.allowImplicitInvocation)
  const path = rawPath ? resolve(mentionPath(rawPath)) : undefined
  const matches = path
    ? skills.filter(skill => skill.path === path)
    : skills.filter(skill => skill.name === name)

  if (!matches.length) {
    throw new Error('Skill is not available for implicit invocation.')
  }
  if (matches.length > 1) {
    throw new Error('Skill name is ambiguous. Call readSkill with path.')
  }

  const skill = matches[0]!
  return {
    name: skill.name,
    path: skill.path,
    contents: await readFile(skill.path, 'utf8')
  }
}

function skillTools<CONTEXT extends JsonLike>(
  options: SkillsPluginOptions<CONTEXT>
): PluginTools<CONTEXT> {
  return {
    readSkill: {
      description:
        'Read complete SKILL.md instructions for a skill listed in the skills catalog. Call this after deciding a skill matches the task, before applying it.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
            description: 'Skill name from the skills catalog.'
          },
          path: {
            type: 'string',
            description: 'Exact skill file path from the skills catalog.'
          }
        }
      },
      execute: (input: unknown) => readSelectedSkill(options, input)
    } as unknown as PluginTools<CONTEXT>[string]
  }
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
  options: SkillsPluginOptions<CONTEXT> = {}
): AgentPlugin<CONTEXT> {
  return {
    name: 'skills',
    tools: skillTools(options),
    hooks: {
      onTurnPrepared: async args => {
        const value = await applySkillsToValue(options, args)
        return value ? { value } : {}
      }
    }
  }
}
