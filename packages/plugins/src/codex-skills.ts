// Origin:
// - Codex: codex-rs/core-skills/src/loader.rs, render.rs, injection.rs, model.rs
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

type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
}

type ResolvedRoot = {
  path: string
  scope: CodexSkillScope
  pluginId?: string
}

type LoadResult = {
  skills: CodexSkill[]
  diagnostics: CodexSkillDiagnostic[]
}

type Frontmatter = Record<string, unknown>

const DEFAULT_MAX_CATALOG_CHARACTERS = 8_000
const MAX_SKILL_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024
const SCOPE_RANK: Record<CodexSkillScope, number> = {
  repo: 0,
  user: 1,
  plugin: 2,
  system: 3,
  admin: 4
}

export type CodexSkillScope = 'repo' | 'user' | 'system' | 'admin' | 'plugin'

export type CodexSkillRoot =
  | string
  | {
      path: string
      scope: CodexSkillScope
      pluginId?: string
    }

export type CodexSkill = {
  name: string
  description: string
  shortDescription?: string
  content: string
  filePath: string
  scope: CodexSkillScope
  pluginId?: string
  policy: {
    allowImplicitInvocation: boolean
    products: readonly string[]
  }
  dependencies: {
    env: readonly string[]
    tools: readonly string[]
  }
}

export type CodexSkillDiagnostic = {
  type: 'warning'
  message: string
  path: string
}

export type CodexSkillsParams<CONTEXT extends JsonLike> = {
  cwd?: string
  roots?: readonly CodexSkillRoot[]
  enabled?: boolean
  includeInstructions?: boolean
  product?: string
  disabledNames?: readonly string[]
  maxCatalogCharacters?: number
  resolveEnv?: (args: {
    name: string
    skill: CodexSkill
    context: CONTEXT
  }) => Awaitable<string | undefined>
  onMissingEnv?: (args: {
    names: readonly string[]
    skill: CodexSkill
    context: CONTEXT
  }) => Awaitable<void>
}

export function withCodexSkills<CONTEXT extends JsonLike>(
  params: CodexSkillsParams<CONTEXT> = {}
): AgentPlugin<CONTEXT> {
  const cwd = params.cwd ?? process.cwd()
  const maxCatalogCharacters =
    params.maxCatalogCharacters ?? DEFAULT_MAX_CATALOG_CHARACTERS
  const load = memoize(() => loadCodexSkills({ cwd, roots: params.roots }))

  return withTurnPrepared(async ({ args, value }) => {
    if (params.enabled === false) return { value }
    const context = args.context as CONTEXT
    const { skills } = await load()
    const available = filterAvailableSkills({
      skills,
      product: params.product,
      disabledNames: params.disabledNames
    })
    if (!available.length) return { value }

    const messages = await buildSkillMessages({
      value,
      skills: available,
      context,
      maxCatalogCharacters,
      includeInstructions: params.includeInstructions !== false,
      params
    })
    if (!messages.length) return { value }
    return { value: prependMessages(value, messages) }
  })
}

export async function loadCodexSkills(params: {
  cwd?: string
  roots?: readonly CodexSkillRoot[]
}): Promise<LoadResult> {
  const diagnostics: CodexSkillDiagnostic[] = []
  const byPath = new Map<string, CodexSkill>()
  for (const root of codexSkillRoots(params)) {
    for (const filePath of await findCodexSkillFiles(root.path)) {
      const loaded = await readCodexSkill({ filePath, root })
      diagnostics.push(...loaded.diagnostics)
      if (loaded.skill) byPath.set(loaded.skill.filePath, loaded.skill)
    }
  }
  return {
    skills: [...byPath.values()].sort(compareCodexSkills),
    diagnostics
  }
}

export function renderCodexSkillInstructions(params: {
  skills: readonly CodexSkill[]
  maxCharacters?: number
}) {
  const maxCharacters = params.maxCharacters ?? DEFAULT_MAX_CATALOG_CHARACTERS
  const header = catalogHeader()
  const lines: string[] = []
  let size = header.length
  for (const skill of params.skills) {
    const line = catalogLine(skill)
    if (size + line.length + 1 > maxCharacters) break
    lines.push(line)
    size += line.length + 1
  }
  return `${header}\n${lines.join('\n')}`
}

export function collectSkillMentions(params: {
  value: AgentTurnPreparedValue
  skills: readonly CodexSkill[]
}) {
  const byName = groupSkillsByName(params.skills)
  const text = messageBodies(params.value).join('\n')
  const selected = new Map<string, CodexSkill>()

  for (const match of text.matchAll(/\$([A-Za-z0-9_.-]+)/g)) {
    const name = match[1]
    if (!name) continue
    const matches = byName.get(name)
    if (matches?.length === 1) selected.set(matches[0]!.filePath, matches[0]!)
  }
  for (const skill of params.skills) {
    if (textMentionsSkillPath(text, skill)) {
      selected.set(skill.filePath, skill)
    }
  }
  return [...selected.values()]
}

function filterAvailableSkills(params: {
  skills: readonly CodexSkill[]
  product?: string
  disabledNames?: readonly string[]
}) {
  const disabled = new Set(params.disabledNames ?? [])
  return params.skills.filter(skill => {
    if (disabled.has(skill.name)) return false
    if (!params.product) return true
    if (!skill.policy.products.length) return true
    return skill.policy.products.includes(params.product)
  })
}

async function buildSkillMessages<CONTEXT extends JsonLike>(args: {
  value: AgentTurnPreparedValue
  skills: readonly CodexSkill[]
  context: CONTEXT
  maxCatalogCharacters: number
  includeInstructions: boolean
  params: CodexSkillsParams<CONTEXT>
}): Promise<Message[]> {
  const messages: Message[] = []
  if (args.includeInstructions) {
    messages.push(
      message(
        'system',
        renderCodexSkillInstructions({
          skills: args.skills,
          maxCharacters: args.maxCatalogCharacters
        })
      )
    )
  }
  const mentions = collectSkillMentions({
    value: args.value,
    skills: args.skills
  })
  for (const skill of mentions) {
    await ensureSkillDependencies({
      skill,
      context: args.context,
      params: args.params
    })
    messages.push(message('system', renderCodexSkillInjection(skill)))
  }
  return messages
}

function memoize<A>(fn: () => Promise<A>): () => Promise<A> {
  let promise: Promise<A> | undefined
  return () => (promise ??= fn())
}

function groupSkillsByName(skills: readonly CodexSkill[]) {
  const byName = new Map<string, CodexSkill[]>()
  for (const skill of skills) {
    const existing = byName.get(skill.name) ?? []
    byName.set(skill.name, [...existing, skill])
  }
  return byName
}

function messageBodies(value: AgentTurnPreparedValue) {
  return (value.messages ?? []).map(messageText)
}

function textMentionsSkillPath(text: string, skill: CodexSkill) {
  return (
    text.includes(skill.filePath) ||
    text.includes(pathToFileURL(skill.filePath).href)
  )
}

function catalogHeader() {
  return [
    '## Skills',
    '',
    'Skills provide specialized instructions. Use them when user request matches skill description. Mention a skill with `$skill-name` to load full instructions.',
    '',
    'Available skills:'
  ].join('\n')
}

function catalogLine(skill: CodexSkill) {
  const description = skill.shortDescription ?? skill.description
  return `- ${skill.name}: ${description} (${scopeLabel(skill)})`
}

function codexSkillRoots(params: {
  cwd?: string
  roots?: readonly CodexSkillRoot[]
}): ResolvedRoot[] {
  const cwd = params.cwd ?? process.cwd()
  const explicit = params.roots ?? []
  if (explicit.length) return explicit.map(root => resolveRoot({ cwd, root }))
  return defaultSkillRoots(cwd)
}

function resolveRoot(params: {
  cwd: string
  root: CodexSkillRoot
}): ResolvedRoot {
  if (typeof params.root === 'string') {
    return {
      path: resolvePath({ cwd: params.cwd, path: params.root }),
      scope: 'repo'
    }
  }
  return {
    ...params.root,
    path: resolvePath({ cwd: params.cwd, path: params.root.path })
  }
}

function defaultSkillRoots(cwd: string): ResolvedRoot[] {
  const codexHome = process.env.CODEX_HOME ?? path.join(homedir(), '.codex')
  return [
    { path: path.join(cwd, '.codex', 'skills'), scope: 'repo' },
    { path: path.join(cwd, '.agents', 'skills'), scope: 'repo' },
    { path: path.join(homedir(), '.agents', 'skills'), scope: 'user' },
    { path: path.join(codexHome, 'skills'), scope: 'user' },
    { path: path.join(codexHome, 'skills', '.system'), scope: 'system' },
    { path: '/etc/codex/skills', scope: 'admin' }
  ]
}

async function readCodexSkill(params: {
  filePath: string
  root: ResolvedRoot
}): Promise<{ skill?: CodexSkill; diagnostics: CodexSkillDiagnostic[] }> {
  const raw = await readFile(params.filePath, 'utf8')
  const { frontmatter, body } = frontmatterBlock(raw)
  const metadata = await readCodexOpenAiMetadata(path.dirname(params.filePath))
  const name =
    stringValue(frontmatter.name) ??
    path.basename(path.dirname(params.filePath))
  const description =
    stringValue(frontmatter.description) ?? stringValue(metadata.description)
  if (!description) {
    return {
      diagnostics: [missingDescriptionDiagnostic(params.filePath)]
    }
  }
  return {
    diagnostics: [],
    skill: buildSkill({
      filePath: params.filePath,
      root: params.root,
      name,
      description,
      body,
      frontmatter,
      metadata
    })
  }
}

function buildSkill(params: {
  filePath: string
  root: ResolvedRoot
  name: string
  description: string
  body: string
  frontmatter: Frontmatter
  metadata: Frontmatter
}): CodexSkill {
  return {
    name: params.name.slice(0, MAX_SKILL_NAME_LENGTH),
    description: params.description.slice(0, MAX_DESCRIPTION_LENGTH),
    shortDescription:
      stringValue(params.frontmatter.short_description) ??
      stringValue(params.metadata.short_description),
    content: params.body.trim(),
    filePath: params.filePath,
    scope: params.root.scope,
    pluginId: params.root.pluginId,
    policy: {
      allowImplicitInvocation:
        booleanValue(params.metadata.allow_implicit_invocation) ?? true,
      products: stringArrayValue(params.metadata.products)
    },
    dependencies: {
      env: stringArrayValue(params.metadata.env),
      tools: stringArrayValue(params.metadata.tools)
    }
  }
}

function missingDescriptionDiagnostic(filePath: string): CodexSkillDiagnostic {
  return {
    type: 'warning',
    message:
      'Skill requires description frontmatter or agents/openai.yaml description.',
    path: filePath
  }
}

async function readCodexOpenAiMetadata(dir: string) {
  const filePath = path.join(dir, 'agents', 'openai.yaml')
  const raw = await readFile(filePath, 'utf8').catch(() => '')
  return parseNestedYaml(raw)
}

async function findCodexSkillFiles(root: string) {
  const files: string[] = []
  await walkFiles({
    dir: root,
    visit: filePath => {
      if (path.basename(filePath) === 'SKILL.md') files.push(filePath)
    }
  })
  return files.sort((a, b) => a.localeCompare(b))
}

async function walkFiles(params: {
  dir: string
  visit: (filePath: string) => void
}) {
  const info = await stat(params.dir).catch(() => undefined)
  if (!info?.isDirectory()) return
  const entries = await readdir(params.dir, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules') continue
    const full = path.join(params.dir, entry.name)
    if (entry.isDirectory()) await walkFiles({ dir: full, visit: params.visit })
    else if (entry.isFile()) params.visit(full)
  }
}

async function ensureSkillDependencies<CONTEXT extends JsonLike>(args: {
  skill: CodexSkill
  context: CONTEXT
  params: CodexSkillsParams<CONTEXT>
}) {
  if (!args.skill.dependencies.env.length) return
  const missing = await missingEnvNames(args)
  if (!missing.length) return
  if (args.params.onMissingEnv) {
    await args.params.onMissingEnv({
      names: missing,
      skill: args.skill,
      context: args.context
    })
    return
  }
  throw new Error(
    `Skill "${args.skill.name}" requires missing environment variables: ${missing.join(', ')}`
  )
}

async function missingEnvNames<CONTEXT extends JsonLike>(args: {
  skill: CodexSkill
  context: CONTEXT
  params: CodexSkillsParams<CONTEXT>
}) {
  const missing: string[] = []
  for (const name of args.skill.dependencies.env) {
    const value = await args.params.resolveEnv?.({
      name,
      skill: args.skill,
      context: args.context
    })
    if (value === undefined) missing.push(name)
  }
  return missing
}

function renderCodexSkillInjection(skill: CodexSkill) {
  const dir = path.dirname(skill.filePath)
  return [
    `<skill_content name="${escapeXml(skill.name)}" path="${escapeXml(skill.filePath)}">`,
    `References are relative to ${dir}.`,
    '',
    skill.content,
    '</skill_content>'
  ].join('\n')
}

function messageText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(contentPartText).join('\n')
  return ''
}

function contentPartText(part: unknown): string {
  if (typeof part === 'string') return part
  if (!part || typeof part !== 'object') return ''
  const text = (part as { text?: unknown }).text
  return typeof text === 'string' ? text : ''
}

function compareCodexSkills(left: CodexSkill, right: CodexSkill) {
  const rank = SCOPE_RANK[left.scope] - SCOPE_RANK[right.scope]
  return rank || left.name.localeCompare(right.name)
}

function scopeLabel(skill: CodexSkill) {
  return skill.pluginId ? `${skill.scope}:${skill.pluginId}` : skill.scope
}

function resolvePath(params: { cwd: string; path: string }) {
  if (params.path === '~') return homedir()
  if (params.path.startsWith('~/')) {
    return path.join(homedir(), params.path.slice(2))
  }
  if (path.isAbsolute(params.path)) return params.path
  return path.resolve(params.cwd, params.path)
}

function frontmatterBlock(raw: string): { frontmatter: Frontmatter; body: string } {
  if (!raw.startsWith('---\n')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return { frontmatter: {}, body: raw }
  return {
    frontmatter: parseFlatYaml(raw.slice(4, end)),
    body: raw.slice(end + 5)
  }
}

function parseFlatYaml(raw: string): Frontmatter {
  const output: Frontmatter = {}
  for (const line of raw.split('\n')) {
    const split = line.indexOf(':')
    if (split < 0) continue
    output[line.slice(0, split).trim()] = scalarValue(line.slice(split + 1))
  }
  return output
}

function parseNestedYaml(raw: string): Frontmatter {
  const output: Frontmatter = {}
  const pathStack: string[] = []
  for (const rawLine of raw.split('\n')) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue
    const indent = rawLine.length - rawLine.trimStart().length
    const depth = Math.floor(indent / 2)
    pathStack.length = depth
    const line = rawLine.trim()
    if (line.startsWith('- ')) {
      appendYamlListItem({ output, pathStack, item: line.slice(2) })
      continue
    }
    const split = line.indexOf(':')
    if (split < 0) continue
    const key = line.slice(0, split).trim()
    const value = line.slice(split + 1)
    if (value.trim()) output[key] = scalarValue(value)
    pathStack[depth] = key
  }
  return output
}

function appendYamlListItem(params: {
  output: Frontmatter
  pathStack: string[]
  item: string
}) {
  const key = params.pathStack[params.pathStack.length - 1]
  if (!key) return
  const values = (params.output[key] ?? []) as unknown[]
  params.output[key] = [...values, scalarValue(params.item)]
}

function scalarValue(raw: string) {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith('[') && value.endsWith(']')) return parseInlineList(value)
  return unquote(value)
}

function parseInlineList(value: string) {
  return value
    .slice(1, -1)
    .split(',')
    .map(item => unquote(item.trim()))
    .filter(Boolean)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function stringArrayValue(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  if (!value.every(item => typeof item === 'string')) return []
  return value
}

function unquote(value: string) {
  const isDoubleQuoted = value.startsWith('"') && value.endsWith('"')
  const isSingleQuoted = value.startsWith("'") && value.endsWith("'")
  if (isDoubleQuoted || isSingleQuoted) return value.slice(1, -1)
  return value
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
