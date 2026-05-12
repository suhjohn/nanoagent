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

type ApplyAuth = (args: {
  provider: string
  token: string
}) => Awaitable<void>

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
  return model.split('/')[0] ?? model
}

async function resolveToken(
  auth: ModelAuthStore,
  provider: string
): Promise<string | undefined> {
  const apiKey = await auth.apiKey(provider)
  if (apiKey) return apiKey
  return auth.oauthToken?.(provider)
}
