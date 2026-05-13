// Origin:
// - OpenCode: packages/opencode/src/skill/index.ts, tool/skill.ts, session/system.ts
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  AgentHookResult,
  AgentTurnPreparedValue,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

type Awaitable<A> = A | Promise<A>

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type Tool<CONTEXT extends JsonLike> = NonNullable<
  RunAgentOptions<CONTEXT>['tools']
>[string]

type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
}

type JsonSchema =
  | { type: 'string'; description?: string; enum?: readonly string[] }
  | {
      type: 'object'
      description?: string
      properties: Record<string, JsonSchema>
      required?: readonly string[]
      additionalProperties?: boolean
    }

type LoadedSkills = {
  skills: OpenCodeSkill[]
  diagnostics: OpenCodeSkillDiagnostic[]
}

type SkillReadResult = {
  skill?: OpenCodeSkill
  diagnostics: OpenCodeSkillDiagnostic[]
}

type AllowFn<CONTEXT extends JsonLike> = (args: {
  name: string
  skill: OpenCodeSkill
  context: CONTEXT
}) => Awaitable<OpenCodeSkillDecision>

export type OpenCodeSkill = {
  name: string
  description: string
  content: string
  filePath: string
}

export type OpenCodeSkillDiagnostic = {
  type: 'warning'
  message: string
  path: string
}

export type OpenCodeSkillDecision = { allow: true } | { allow: false }

export type OpenCodeSkillsParams<CONTEXT extends JsonLike> = {
  cwd?: string
  dirs?: readonly string[]
  urls?: readonly string[]
  includeGlobal?: boolean
  includeProjectAncestors?: boolean
  includeCatalog?: boolean
  fileSampleLimit?: number
  toolName?: string
  allow?: AllowFn<CONTEXT>
}

export type OpenCodeSkillToolOutput = {
  name: string
  description: string
  location: string
  directory: string
  content: string
  note: string
  files: string[]
}

export function withOpenCodeSkills<CONTEXT extends JsonLike>(
  params: OpenCodeSkillsParams<CONTEXT> = {}
): AgentPlugin<CONTEXT> {
  const toolName = params.toolName ?? 'skill'
  const cwd = params.cwd ?? process.cwd()
  const fileSampleLimit = params.fileSampleLimit ?? 10
  const load = memoize(() =>
    loadOpenCodeSkills({
      cwd,
      dirs: params.dirs,
      urls: params.urls,
      includeGlobal: params.includeGlobal ?? true,
      includeProjectAncestors: params.includeProjectAncestors ?? true
    })
  )

  const catalogPlugin = withTurnPrepared<CONTEXT>(async ({ args, value }) => {
    if (params.includeCatalog === false) return { value }
    const { skills } = await load()
    const visible = await filterAllowedSkills({
      skills,
      allow: params.allow,
      context: args.context as CONTEXT
    })
    if (!visible.length) return { value }
    return {
      value: prependMessages(value, [
        message('system', renderOpenCodeSkillCatalog(visible))
      ])
    }
  })

  const toolPlugin: AgentPlugin<CONTEXT> = options => ({
    ...options,
    tools: {
      ...(options.tools ?? {}),
      [toolName]: buildSkillTool<CONTEXT>({
        toolName,
        load,
        allow: params.allow,
        fileSampleLimit
      })
    }
  })

  return options => toolPlugin(catalogPlugin(options))
}

export async function loadOpenCodeSkills(params: {
  cwd?: string
  dirs?: readonly string[]
  urls?: readonly string[]
  includeGlobal?: boolean
  includeProjectAncestors?: boolean
}): Promise<LoadedSkills> {
  const diagnostics: OpenCodeSkillDiagnostic[] = []
  const byName = new Map<string, OpenCodeSkill>()

  for (const dir of openCodeSkillRoots(params)) {
    for (const filePath of await findSkillFiles(dir)) {
      collectSkill(byName, diagnostics, await readOpenCodeSkill(filePath))
    }
  }
  for (const url of params.urls ?? []) {
    collectSkill(byName, diagnostics, await readOpenCodeSkillUrl(url))
  }

  return {
    skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics
  }
}

function collectSkill(
  byName: Map<string, OpenCodeSkill>,
  diagnostics: OpenCodeSkillDiagnostic[],
  loaded: SkillReadResult
) {
  diagnostics.push(...loaded.diagnostics)
  if (loaded.skill) byName.set(loaded.skill.name, loaded.skill)
}

function buildSkillTool<CONTEXT extends JsonLike>(params: {
  toolName: string
  load: () => Promise<LoadedSkills>
  allow?: AllowFn<CONTEXT>
  fileSampleLimit: number
}): Tool<CONTEXT> {
  const { toolName, load, allow, fileSampleLimit } = params
  return {
    description:
      'Load full instructions for one available skill by name. Use when task matches listed skill description.',
    inputSchema: objectSchema(
      {
        name: {
          type: 'string',
          description: 'Skill name exactly as listed in available skills.'
        }
      },
      ['name']
    ),
    execute: async (
      input: unknown,
      options: { experimental_context?: CONTEXT }
    ): Promise<OpenCodeSkillToolOutput> => {
      const record = assertRecord(input, toolName)
      const name = stringField(record, 'name')
      const { skills } = await load()
      const skill = findSkillOrThrow(skills, name)
      await assertAllowed({
        allow,
        name,
        skill,
        context: options.experimental_context as CONTEXT
      })
      return renderSkillToolOutput({ skill, fileSampleLimit })
    }
  } as unknown as Tool<CONTEXT>
}

function findSkillOrThrow(skills: readonly OpenCodeSkill[], name: string) {
  const skill = skills.find(item => item.name === name)
  if (skill) return skill
  const available = skills.map(item => item.name).join(', ')
  throw new Error(`Unknown skill "${name}". Available skills: ${available}`)
}

async function assertAllowed<CONTEXT extends JsonLike>(params: {
  allow?: AllowFn<CONTEXT>
  name: string
  skill: OpenCodeSkill
  context: CONTEXT
}) {
  if (!params.allow) return
  const decision = await params.allow({
    name: params.name,
    skill: params.skill,
    context: params.context
  })
  if (decision?.allow === false) {
    throw new Error(`Skill "${params.name}" denied.`)
  }
}

async function filterAllowedSkills<CONTEXT extends JsonLike>(params: {
  skills: readonly OpenCodeSkill[]
  allow?: AllowFn<CONTEXT>
  context: CONTEXT
}) {
  if (!params.allow) return [...params.skills]
  const visible: OpenCodeSkill[] = []
  for (const skill of params.skills) {
    const decision = await params.allow({
      name: skill.name,
      skill,
      context: params.context
    })
    if (decision?.allow !== false) visible.push(skill)
  }
  return visible
}

async function renderSkillToolOutput(params: {
  skill: OpenCodeSkill
  fileSampleLimit: number
}): Promise<OpenCodeSkillToolOutput> {
  const { skill, fileSampleLimit } = params
  const remote = isHttpUrl(skill.filePath)
  const directory = remote
    ? new URL('.', skill.filePath).href
    : path.dirname(skill.filePath)
  const directoryHref = remote ? directory : pathToFileURL(directory).href
  const files = remote
    ? []
    : await sampleSkillFiles({ dir: directory, limit: fileSampleLimit })

  return {
    name: skill.name,
    description: skill.description,
    location: skillLocation(skill.filePath),
    directory: directoryHref,
    content: `<skill_content name="${skill.name}">\n${skill.content}\n</skill_content>`,
    note: `Relative references are resolved from ${directory}.`,
    files
  }
}

function openCodeSkillRoots(params: {
  cwd?: string
  dirs?: readonly string[]
  includeGlobal?: boolean
  includeProjectAncestors?: boolean
}) {
  const cwd = params.cwd ?? process.cwd()
  const roots: string[] = []

  if (params.includeGlobal !== false) {
    roots.push(...skillDirsFor(homedir()))
  }
  if (params.includeProjectAncestors !== false) {
    for (const dir of ancestors(cwd)) roots.push(...skillDirsFor(dir))
  }
  for (const dir of params.dirs ?? []) {
    roots.push(resolvePath({ cwd, path: dir }))
  }

  return [...new Set(roots)]
}

function skillDirsFor(base: string) {
  return [path.join(base, '.claude'), path.join(base, '.agents')]
}

async function readOpenCodeSkill(filePath: string): Promise<SkillReadResult> {
  const raw = await readFile(filePath, 'utf8')
  return skillFromRaw({ raw, filePath, fallbackName: undefined })
}

async function readOpenCodeSkillUrl(url: string): Promise<SkillReadResult> {
  const response = await fetch(url)
  if (!response.ok) {
    return {
      diagnostics: [
        {
          type: 'warning',
          message: `Skill URL returned ${response.status}.`,
          path: url
        }
      ]
    }
  }
  const raw = await response.text()
  const fallbackName = path.basename(new URL(url).pathname, '.md')
  return skillFromRaw({
    raw,
    filePath: url,
    fallbackName,
    missingMessage:
      'Skill URL requires string name and description frontmatter.'
  })
}

function skillFromRaw(params: {
  raw: string
  filePath: string
  fallbackName?: string
  missingMessage?: string
}): SkillReadResult {
  const { frontmatter, body } = frontmatterBlock(params.raw)
  const name =
    stringFrontmatter(frontmatter, 'name') ?? params.fallbackName ?? ''
  const description = stringFrontmatter(frontmatter, 'description') ?? ''

  if (!name || !description) {
    return {
      diagnostics: [
        {
          type: 'warning',
          message:
            params.missingMessage ??
            'Skill requires string name and description frontmatter.',
          path: params.filePath
        }
      ]
    }
  }
  return {
    diagnostics: [],
    skill: {
      name,
      description,
      content: body.trim(),
      filePath: params.filePath
    }
  }
}

function stringFrontmatter(
  frontmatter: Record<string, unknown>,
  key: string
): string | undefined {
  const value = frontmatter[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

async function findSkillFiles(root: string) {
  const files: string[] = []
  await walkFiles({
    dir: root,
    visit: filePath => {
      if (path.basename(filePath) === 'SKILL.md') files.push(filePath)
    }
  })
  return files.sort((a, b) => a.localeCompare(b))
}

async function sampleSkillFiles(params: { dir: string; limit: number }) {
  if (params.limit <= 0) return []
  const files: string[] = []
  await walkFiles({
    dir: params.dir,
    visit: filePath => {
      if (files.length >= params.limit) return
      if (path.basename(filePath) === 'SKILL.md') return
      files.push(path.relative(params.dir, filePath))
    }
  })
  return files.sort((a, b) => a.localeCompare(b)).slice(0, params.limit)
}

async function walkFiles(params: {
  dir: string
  visit: (filePath: string) => void
}) {
  const info = await stat(params.dir).catch(() => undefined)
  if (!info?.isDirectory()) return
  const entries = await readdir(params.dir, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(params.dir, entry.name)
    if (entry.isDirectory()) await walkFiles({ dir: full, visit: params.visit })
    else if (entry.isFile()) params.visit(full)
  }
}

function renderOpenCodeSkillCatalog(skills: readonly OpenCodeSkill[]) {
  const items = skills.map(renderSkillEntry).join('\n')
  return `<available_skills>\n${items}\n</available_skills>`
}

function renderSkillEntry(skill: OpenCodeSkill) {
  const name = escapeXml(skill.name)
  const description = escapeXml(skill.description)
  const location = escapeXml(skillLocation(skill.filePath))
  return `<skill>\n<name>${name}</name>\n<description>${description}</description>\n<location>${location}</location>\n</skill>`
}

function ancestors(start: string) {
  const dirs: string[] = []
  for (let current = path.resolve(start); ; current = path.dirname(current)) {
    dirs.push(current)
    if (path.dirname(current) === current) return dirs
  }
}

function resolvePath(params: { cwd: string; path: string }) {
  if (params.path === '~') return homedir()
  if (params.path.startsWith('~/')) {
    return path.join(homedir(), params.path.slice(2))
  }
  if (path.isAbsolute(params.path)) return params.path
  return path.resolve(params.cwd, params.path)
}

function skillLocation(filePath: string) {
  return isHttpUrl(filePath) ? filePath : pathToFileURL(filePath).href
}

function isHttpUrl(value: string) {
  return value.startsWith('http://') || value.startsWith('https://')
}

function frontmatterBlock(raw: string) {
  const empty = {} as Record<string, unknown>
  if (!raw.startsWith('---\n')) return { frontmatter: empty, body: raw }
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return { frontmatter: empty, body: raw }
  return {
    frontmatter: parseFlatYaml(raw.slice(4, end)),
    body: raw.slice(end + 5)
  }
}

function parseFlatYaml(raw: string) {
  const output: Record<string, unknown> = {}
  for (const line of raw.split('\n')) {
    const split = line.indexOf(':')
    if (split < 0) continue
    const key = line.slice(0, split).trim()
    output[key] = parseYamlScalar(line.slice(split + 1).trim())
  }
  return output
}

function parseYamlScalar(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  return unquote(value)
}

function unquote(value: string) {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  return quoted ? value.slice(1, -1) : value
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function withTurnPrepared<CONTEXT extends JsonLike>(
  transform: (args: {
    args: Parameters<RunAgentOptions<CONTEXT>['hooks']['onTurnPrepared']>[0]
    value: AgentTurnPreparedValue
  }) => Awaitable<AgentHookResult<AgentTurnPreparedValue, CONTEXT>>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    hooks: {
      ...options.hooks,
      onTurnPrepared: async args => {
        const previous = (await options.hooks.onTurnPrepared(
          args
        )) as AgentHookResult<AgentTurnPreparedValue, CONTEXT>
        if (previous?.control) return previous
        const value = previous?.value
        if (!value) return previous

        const next = await transform({ args, value })
        return {
          context: next?.context ?? previous?.context,
          value: next?.value ?? value,
          control: next?.control
        }
      }
    }
  })
}

function memoize<A>(fn: () => Promise<A>): () => Promise<A> {
  let promise: Promise<A> | undefined
  return () => (promise ??= fn())
}

function message(role: Message['role'], content: unknown): Message {
  return { role, content }
}

function prependMessages(
  value: AgentTurnPreparedValue,
  messages: readonly Message[]
) {
  return {
    ...value,
    messages: [...messages, ...(value.messages ?? [])]
  } as AgentTurnPreparedValue
}

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[] = []
): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

function assertRecord(input: unknown, name: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${name} input must be an object.`)
  }
  return input as Record<string, unknown>
}

function stringField(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}
