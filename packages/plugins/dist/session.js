export function withSessionStore(store) {
  return withSaveState(args => store.save(args))
}
export function withEventSink(sink) {
  return withSaveState(async ({ events }) => {
    for (const event of events) await sink(event)
  })
}
export function withTranscriptRecorder(record) {
  return withTurnCompleted(args =>
    record({
      context: args.context,
      state: args.state,
      turnId: args.turn.turnId
    })
  )
}
function withSaveState(effect) {
  return options => ({
    ...options,
    saveState: async args => {
      await options.saveState?.(args)
      await effect(args)
    }
  })
}
function withTurnCompleted(effect) {
  return options => ({
    ...options,
    hooks: {
      ...options.hooks,
      onTurnCompleted: async args => {
        const previous = await options.hooks.onTurnCompleted?.(args)
        if (previous?.control) return previous
        await effect(args)
        return previous
      }
    }
  })
}
