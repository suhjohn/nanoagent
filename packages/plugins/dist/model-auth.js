export function createEnvModelAuthStore(env = process.env) {
    return {
        apiKey: provider => firstEnv(env, authEnvNames(provider, 'API_KEY')),
        oauthToken: provider => firstEnv(env, authEnvNames(provider, 'OAUTH_TOKEN'))
    };
}
export function createMemoryModelAuthStore(params) {
    const apiKeys = normalizeTokenRecord(params.apiKeys);
    const oauthTokens = normalizeTokenRecord(params.oauthTokens);
    return {
        apiKey: provider => apiKeys[normalizeProvider(provider)],
        oauthToken: provider => oauthTokens[normalizeProvider(provider)]
    };
}
export function withModelAuth(params) {
    return options => {
        const merged = mergeProviders(options, params.providers);
        return {
            ...merged,
            middleware: {
                ...merged.middleware,
                callModel: [
                    ...(merged.middleware?.callModel ?? []),
                    async ({ input, next }) => {
                        const provider = providerFromModel(input.args.model);
                        const token = await resolveToken(params.auth, provider);
                        if (token)
                            await params.apply?.({ provider, token });
                        return next(input);
                    }
                ]
            }
        };
    };
}
function mergeProviders(options, providers) {
    if (!providers)
        return options;
    return {
        ...options,
        modelProviders: { ...(options.modelProviders ?? {}), ...providers }
    };
}
function providerFromModel(model) {
    return normalizeProvider(model.split('/')[0] ?? model);
}
async function resolveToken(auth, provider) {
    const apiKey = await auth.apiKey(provider);
    if (apiKey)
        return apiKey;
    return auth.oauthToken?.(provider);
}
function normalizeProvider(provider) {
    return provider.trim().toLowerCase();
}
function authEnvNames(provider, suffix) {
    const normalized = normalizeProvider(provider);
    const upper = normalized.replace(/[^a-z0-9]+/g, '_').toUpperCase();
    return [`${upper}_${suffix}`, `NANO_${upper}_${suffix}`];
}
function firstEnv(env, names) {
    for (const name of names) {
        const value = env[name];
        if (value)
            return value;
    }
    return undefined;
}
function normalizeTokenRecord(input) {
    const output = {};
    for (const [provider, token] of Object.entries(input ?? {})) {
        output[normalizeProvider(provider)] = token;
    }
    return output;
}
