// Origin:
// - Pi: packages/coding-agent/src/core/auth-storage.ts, model-registry.ts
// - OpenCode: packages/opencode/src/provider/auth.ts, provider/provider.ts
// Behavior: resolve API/OAuth credentials before model calls and let host apply provider-specific auth.
import type {
  AgentModelProviders,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

type Awaitable<A> = A | Promise<A>

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

export type ModelAuthStore = {
  apiKey(provider: string): Awaitable<string | undefined>
  oauthToken?(provider: string): Awaitable<string | undefined>
}

type ApplyAuth = (args: { provider: string; token: string }) => Awaitable<void>

export function createEnvModelAuthStore(
  env: Record<string, string | undefined> = process.env
): ModelAuthStore {
  return {
    apiKey: provider => firstEnv(env, authEnvNames(provider, 'API_KEY')),
    oauthToken: provider => firstEnv(env, authEnvNames(provider, 'OAUTH_TOKEN'))
  }
}

export function createMemoryModelAuthStore(params: {
  apiKeys?: Record<string, string>
  oauthTokens?: Record<string, string>
}): ModelAuthStore {
  const apiKeys = normalizeTokenRecord(params.apiKeys)
  const oauthTokens = normalizeTokenRecord(params.oauthTokens)
  return {
    apiKey: provider => apiKeys[normalizeProvider(provider)],
    oauthToken: provider => oauthTokens[normalizeProvider(provider)]
  }
}

export function withModelAuth<CONTEXT extends JsonLike>(params: {
  providers?: AgentModelProviders
  auth: ModelAuthStore
  apply?: ApplyAuth
}): AgentPlugin<CONTEXT> {
  return options => {
    const merged = mergeProviders(options, params.providers)
    return {
      ...merged,
      middleware: {
        ...merged.middleware,
        callModel: [
          ...(merged.middleware?.callModel ?? []),
          async ({ input, next }) => {
            const provider = providerFromModel(input.args.model)
            const token = await resolveToken(params.auth, provider)
            if (token) await params.apply?.({ provider, token })
            return next(input)
          }
        ]
      }
    }
  }
}

function mergeProviders<CONTEXT extends JsonLike>(
  options: RunAgentOptions<CONTEXT>,
  providers: AgentModelProviders | undefined
): RunAgentOptions<CONTEXT> {
  if (!providers) return options
  return {
    ...options,
    modelProviders: { ...(options.modelProviders ?? {}), ...providers }
  }
}

function providerFromModel(model: string): string {
  return normalizeProvider(model.split('/')[0] ?? model)
}

async function resolveToken(
  auth: ModelAuthStore,
  provider: string
): Promise<string | undefined> {
  const apiKey = await auth.apiKey(provider)
  if (apiKey) return apiKey
  return auth.oauthToken?.(provider)
}

function normalizeProvider(provider: string) {
  return provider.trim().toLowerCase()
}

function authEnvNames(provider: string, suffix: string) {
  const normalized = normalizeProvider(provider)
  const upper = normalized.replace(/[^a-z0-9]+/g, '_').toUpperCase()
  return [`${upper}_${suffix}`, `NANO_${upper}_${suffix}`]
}

function firstEnv(
  env: Record<string, string | undefined>,
  names: readonly string[]
) {
  for (const name of names) {
    const value = env[name]
    if (value) return value
  }
  return undefined
}

function normalizeTokenRecord(input: Record<string, string> | undefined) {
  const output: Record<string, string> = {}
  for (const [provider, token] of Object.entries(input ?? {})) {
    output[normalizeProvider(provider)] = token
  }
  return output
}
