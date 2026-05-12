import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentHookResult,
  AgentTurnPreparedValue,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
}

export type Skill = {
  name: string
  description: string
  content: string
  filePath: string
  disableModelInvocation: boolean
}

export type SkillDiagnostic = {
  type: 'warning'
  message: string
  path: string
}

type LoadSkillsResult = {
  skills: Skill[]
  diagnostics: SkillDiagnostic[]
}

const SKILL_NAME_MAX = 64
const SKILL_DESCRIPTION_MAX = 1024
const FRONTMATTER_OPEN = '---\n'
const FRONTMATTER_CLOSE = '\n---\n'

export async function loadSkills(
  dirs: readonly string[]
): Promise<LoadSkillsResult> {
  const result: LoadSkillsResult = { skills: [], diagnostics: [] }
  for (const dir of dirs) await collectSkills(dir, result)
  return result
}

export function withDiscoveredSkills<CONTEXT extends JsonLike>(params: {
  dirs: readonly string[]
}): AgentPlugin<CONTEXT> {
  const load = memoize(() => loadSkills(params.dirs))

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

        const { skills } = await load()
        const invokable = skills.filter(skill => !skill.disableModelInvocation)
        if (!invokable.length) return previous

        return {
          context: previous?.context,
          value: prependMessages(value, [
            message('system', renderCatalog(invokable))
          ])
        }
      }
    }
  })
}

export function formatSkillInvocation(
  skill: Skill,
  additionalInstructions?: string
) {
  const body = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${path.dirname(skill.filePath)}.\n\n${skill.content}\n</skill>`
  return additionalInstructions ? `${body}\n\n${additionalInstructions}` : body
}

function renderCatalog(skills: readonly Skill[]): string {
  const lines = skills.map(
    skill => `- ${skill.name}: ${skill.description} (${skill.filePath})`
  )
  return `<available_skills>\n${lines.join('\n')}\n</available_skills>`
}

async function collectSkills(dir: string, result: LoadSkillsResult) {
  const info = await stat(dir).catch(() => undefined)
  if (!info?.isDirectory()) return

  const entries = await readdir(dir, { withFileTypes: true })
  const skillFile = entries.find(
    entry => entry.isFile() && entry.name === 'SKILL.md'
  )
  if (skillFile) {
    await appendSkill(path.join(dir, skillFile.name), result)
    return
  }

  for (const entry of [...entries].sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectSkills(full, result)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      await appendSkill(full, result)
    }
  }
}

async function appendSkill(filePath: string, result: LoadSkillsResult) {
  const loaded = await loadSkill(filePath)
  if (loaded.skill) result.skills.push(loaded.skill)
  result.diagnostics.push(...loaded.diagnostics)
}

async function loadSkill(filePath: string): Promise<{
  skill: Skill | undefined
  diagnostics: SkillDiagnostic[]
}> {
  const raw = await readFile(filePath, 'utf8')
  const { frontmatter, body } = frontmatterBlock(raw)

  const description =
    typeof frontmatter.description === 'string'
      ? frontmatter.description.trim()
      : ''
  if (!description) {
    return {
      skill: undefined,
      diagnostics: [
        {
          type: 'warning',
          message: 'Skill missing description.',
          path: filePath
        }
      ]
    }
  }

  const name = String(
    frontmatter.name ?? path.basename(path.dirname(filePath))
  ).slice(0, SKILL_NAME_MAX)

  return {
    skill: {
      name,
      description: description.slice(0, SKILL_DESCRIPTION_MAX),
      content: body,
      filePath,
      disableModelInvocation: frontmatter['disable-model-invocation'] === true
    },
    diagnostics: []
  }
}

function frontmatterBlock(raw: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  if (!raw.startsWith(FRONTMATTER_OPEN)) return { frontmatter: {}, body: raw }
  const end = raw.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length)
  if (end < 0) return { frontmatter: {}, body: raw }

  const frontmatter: Record<string, unknown> = {}
  for (const line of raw.slice(FRONTMATTER_OPEN.length, end).split('\n')) {
    const split = line.indexOf(':')
    if (split < 0) continue
    frontmatter[line.slice(0, split).trim()] = parseScalar(
      line.slice(split + 1).trim()
    )
  }
  return { frontmatter, body: raw.slice(end + FRONTMATTER_CLOSE.length) }
}

function parseScalar(value: string): string | boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
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
): AgentTurnPreparedValue {
  return {
    ...value,
    messages: [...messages, ...(value.messages ?? [])]
  } as AgentTurnPreparedValue
}
