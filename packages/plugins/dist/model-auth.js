export function withModelAuth(params) {
    return options => {
        const configured = params.providers
            ? {
                ...options,
                modelProviders: {
                    ...(options.modelProviders ?? {}),
                    ...params.providers
                }
            }
            : options;
        return {
            ...configured,
            middleware: {
                ...configured.middleware,
                callModel: [
                    ...(configured.middleware?.callModel ?? []),
                    async ({ input, next }) => {
                        const provider = input.args.model.split('/')[0] ?? input.args.model;
                        const token = (await params.auth.apiKey(provider)) ??
                            (await params.auth.oauthToken?.(provider));
                        if (token)
                            await params.apply?.({ provider, token });
                        return next(input);
                    }
                ]
            }
        };
    };
}
