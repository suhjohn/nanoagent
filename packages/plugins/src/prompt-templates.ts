// @ts-nocheck
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export async function loadPromptTemplates(dirs) {
  const templates = []
  for (const dir of dirs) {
    const info = await stat(dir).catch(() => undefined)
    if (!info?.isDirectory()) continue
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const filePath = path.join(dir, entry.name)
      const raw = await readFile(filePath, 'utf8')
      const { frontmatter, body } = frontmatterBlock(raw)
      templates.push({
        name: path.basename(entry.name, '.md'),
        description:
          typeof frontmatter.description === 'string'
            ? frontmatter.description
            : undefined,
        content: body,
        filePath
      })
    }
  }
  return templates
}

export function expandPromptTemplate(template, args) {
  return template
    .replace(/\$\{@:([0-9]+):([0-9]+)\}/g, (_match, start, count) =>
      args.slice(Number(start) - 1, Number(start) - 1 + Number(count)).join(' ')
    )
    .replace(/\$\{@:([0-9]+)\}/g, (_match, start) =>
      args.slice(Number(start) - 1).join(' ')
    )
    .replace(/\$ARGUMENTS/g, args.join(' '))
    .replace(/\$@/g, args.join(' '))
    .replace(
      /\$([1-9][0-9]*)/g,
      (_match, index) => args[Number(index) - 1] ?? ''
    )
}

export function withPromptTemplates(params) {
  let cached
  return options => ({
    ...options,
    hooks: {
      ...options.hooks,
      onTurnPrepared: async args => {
        const previous = await options.hooks.onTurnPrepared(args)
        if (previous?.control) return previous
        const value = previous?.value
        if (!value) return previous

        const command = parseSlashCommand(params.getInput(args.context))
        if (!command) return previous

        cached ??= loadPromptTemplates(params.dirs)
        const template = (await cached).find(t => t.name === command.name)
        if (!template) return previous

        const expanded = expandPromptTemplate(template.content, command.args)
        return {
          context: previous?.context,
          value: {
            ...value,
            messages: [
              ...(value.messages ?? []),
              { role: 'user', content: expanded }
            ]
          }
        }
      }
    }
  })
}

function parseSlashCommand(input) {
  if (typeof input !== 'string' || !input.startsWith('/')) return undefined
  const [name, ...args] = parseArgs(input.slice(1))
  if (!name) return undefined
  return { name, args }
}

function parseArgs(input) {
  return [...input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    match => match[1] ?? match[2] ?? match[3] ?? ''
  )
}

function frontmatterBlock(raw) {
  if (!raw.startsWith('---\n')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return { frontmatter: {}, body: raw }
  const frontmatter = {}
  for (const line of raw.slice(4, end).split('\n')) {
    const split = line.indexOf(':')
    if (split > 0)
      frontmatter[line.slice(0, split).trim()] = line.slice(split + 1).trim()
  }
  return { frontmatter, body: raw.slice(end + 5) }
}
