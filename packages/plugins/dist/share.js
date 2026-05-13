export function withShareSync(params) {
    let timer;
    let latest;
    const flush = async () => {
        const pending = latest;
        if (!pending)
            return;
        latest = undefined;
        await params.client.sync(pending);
    };
    return withSaveState(async ({ state, events }) => {
        latest = { state, events, context: state.context };
        if (!params.debounceMs) {
            await flush();
            return;
        }
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => void flush(), params.debounceMs);
    });
}
function withSaveState(effect) {
    return options => ({
        ...options,
        saveState: async (args) => {
            await options.saveState?.(args);
            await effect(args);
        }
    });
}
