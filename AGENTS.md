# Effect TS

Effect TS is now generally referred to as **Effect**, with the kernel package imported from `effect`.

Effect is a TypeScript library for describing, composing, and running synchronous, asynchronous, concurrent, and resourceful programs with explicit types for success values, expected failures, and dependencies.

## Mental Model

The central type is:

```ts
Effect<Success, Error, Requirements>;
```

This means:

- `Success`: the value produced when the program succeeds.
- `Error`: expected, recoverable failures tracked by the type system.
- `Requirements`: services or contextual dependencies required to run the program.

An `Effect` is lazy. Creating one does not execute anything. It is an immutable description of a workflow that the Effect runtime executes later.

Conceptually:

```ts
Effect<A, E, R>;
```

means:

- The program can return an `A`.
- The program can fail with an `E`.
- The program needs an environment containing `R`.

Effects should usually be executed at the edge of the application, such as `main`, an HTTP handler boundary, a worker entry point, or framework adapter code.

## How Effect Differs From Promise

Promises are eager and one-shot. Once a `Promise` is created, the work has already started, and it can only resolve or reject once.

Effects are lazy and repeatable. They describe work that can be interpreted multiple times by the runtime.

Effect also provides:

- Typed expected errors.
- Structured concurrency.
- Fiber interruption and cancellation.
- Resource finalization.
- Dependency injection through typed context.
- Runtime observability.
- Retry, timeout, scheduling, batching, caching, streams, and schema tools.

## Expected Errors vs Defects

Effect distinguishes between two kinds of failure.

Expected errors are recoverable domain or operational failures. They are part of normal program behavior and appear in the `Error` channel:

```ts
Effect<User, UserNotFound | DatabaseError, UserRepo>;
```

Defects are unexpected, unrecoverable, or programmer errors. They are not tracked in the `Error` channel, but the Effect runtime preserves detailed failure information for debugging and reporting.

Use expected errors for business and recoverable operational cases. Use defects only when there is no meaningful recovery path.

## Core Patterns

### Keep `kernel` Effect-Native

`packages/kernel` is execution kernel. Keep it simple, functional, and Effect-native.

- Compose kernel operations as `Effect` values. Interpret them only at runtime edges such as async generator yield points, framework adapters, process entry points, or tests.
- Keep middleware `next` functions Effect-returning so middleware can use `Effect.gen` and `yield* next(input)` directly.
- Treat hooks, middleware, model providers, tool execution, streaming, time, UUID generation, and commit persistence as boundary effects.
- Keep state transitions as immutable values. Do not mutate run state, events, hook args, or middleware inputs in place.
- Clone and freeze data before exposing it to hooks when kernel correctness depends on immutability.
- Use explicit return values for state changes. Do not hide state changes in callbacks when returning next run state, events, or result is clearer.
- Prefer small pure helpers for state/event construction and Effect helpers for external calls. Avoid Promise-first helper APIs inside kernel.
- Do not add plugin, skill, MCP, filesystem, shell, package-manager, or coding-agent behavior to kernel. Kernel owns run loop, run state, pause/resume, model/tool operation boundaries, streaming events, commit barrier, and middleware composition.

### Use `Effect.gen` For Workflows

`Effect.gen` is the most readable default for business workflows. It looks similar to `async` / `await`, but keeps typed errors, requirements, interruption, and runtime behavior.

```ts
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const user = yield* UserRepo.findById(userId);
  const account = yield* Billing.createAccount(user);
  return account;
});
```

Use `pipe` for small transformations. Use `Effect.gen` when the code has sequencing, branching, loops, or named intermediate values.

### Wrap Unsafe Boundaries Immediately

External code throws, rejects, returns unknown data, or mutates state. Convert those boundaries into Effect values as early as possible.

For synchronous code that cannot throw:

```ts
const now = Effect.sync(() => Date.now());
```

For synchronous code that can throw:

```ts
const parseJson = (input: string) =>
  Effect.try({
    try: () => JSON.parse(input),
    catch: (cause) => new ParseError({ cause }),
  });
```

For promise-based APIs:

```ts
const getJson = Effect.tryPromise({
  try: () => fetch(url).then((response) => response.json()),
  catch: (cause) => new FetchError({ cause }),
});
```

Avoid letting `unknown`, rejected promises, or thrown exceptions leak into core application logic.

### Model Domain Errors Explicitly

Tagged errors work well with Effect's error handling tools:

```ts
import { Data } from "effect";

class UserNotFound extends Data.TaggedError("UserNotFound")<{
  readonly id: string;
}> {}
```

This gives each error a discriminant and works naturally with `Effect.catchTag` and `Effect.catchTags`.

### Use Services For Capabilities

Services represent capabilities your program needs: database access, logging, clocks, HTTP clients, repositories, configuration, queues, feature flags, and so on.

An Effect that needs a service expresses that need in its requirements type:

```ts
Effect<User, UserNotFound, UserRepo>;
```

This avoids manually passing dependency objects through every function.

### Use Layers For Construction

Layers construct services and their dependency graph.

A service interface should describe what the service does. Its layer should describe how the service is built.

For example, a `UserRepo` service may depend on `Database`, `Logger`, and `Config` during construction. Those dependencies should belong to the `UserRepo.Live` layer, not leak into every method of `UserRepo`.

### Run At The Application Edge

For Node apps, prefer platform runtime entry points such as:

```ts
import { NodeRuntime } from "@effect/platform-node";

NodeRuntime.runMain(program);
```

This supports graceful interruption and resource teardown.

Use `Effect.runPromise` mainly for interop with promise-based frameworks or libraries.

### Use Built-In Resilience Tools

Prefer Effect's retry, timeout, schedule, and interruption APIs over hand-written loops and ad hoc `AbortController` code.

```ts
const resilientCall = apiCall.pipe(
  Effect.retry(Schedule.exponential("100 millis")),
  Effect.timeout("5 seconds"),
);
```

### Use Schema At IO Boundaries

Use `effect/Schema` for data that crosses trust boundaries:

- HTTP request bodies.
- API responses.
- Environment variables.
- JSON files.
- Queue messages.
- Database payloads.

Schemas can decode, encode, assert, generate JSON Schema, generate test arbitraries, derive equivalence, and pretty-print data.

## Anti-Patterns

### Running Effects Throughout The Codebase

Avoid this:

```ts
const user = await Effect.runPromise(UserRepo.findById(id));
```

inside domain code.

Running effects too early collapses Effect back into Promise-based code and loses typed composition of errors, dependencies, interruption, and resource safety.

Prefer returning an `Effect` and running it only at the boundary.

### Using `Effect.sync` For Throwing Code

`Effect.sync` assumes the function does not throw. If it throws, the error becomes a defect.

Use `Effect.try` for throwing sync code and `Effect.tryPromise` for rejecting async code.

### Silencing Errors With `orDie`

`Effect.orDie` converts expected errors into defects and removes them from the error channel.

This is appropriate only when the error is genuinely unrecoverable from a business perspective. Do not use it just to make types easier.

### Catching Errors Too Early

Avoid converting errors to generic strings, booleans, or `null` too deep in the system.

Let precise domain errors propagate until a layer that can make a meaningful decision:

- Retry.
- Fallback.
- Return an HTTP status.
- Log and terminate.
- Ask the caller for different input.

### Leaking Construction Dependencies

Avoid service methods that expose all implementation dependencies in their return type.

Bad shape:

```ts
Effect<User, DatabaseError, Database | Logger | Config>;
```

for every public method.

Better shape:

```ts
Effect<User, UserRepoError, UserRepo>;
```

and let the `UserRepo` layer depend on `Database`, `Logger`, and `Config`.

### Overusing Point-Free Style

The official guidelines recommend avoiding tacit or point-free calls like:

```ts
Effect.map(fn);
```

Prefer explicit lambdas:

```ts
Effect.map((value) => fn(value));
```

This avoids subtle inference issues, especially around overloaded functions and optional parameters.

### Excessive Nested `pipe`

Long nested `pipe` expressions become hard to read for workflow logic.

Use `Effect.gen` when you need clear sequencing, branching, loops, or multiple intermediate values.

### Treating Effect As A Small Utility Library

Effect is most valuable when a meaningful part of the system uses its model consistently. If only a few random functions return `Effect`, the team pays learning and integration costs without getting the full benefits.

Partial adoption can still work, but it should happen at clear boundaries:

- External IO wrappers.
- Repository and service layers.
- Worker jobs.
- CLI commands.
- HTTP handler internals.

## When To Use Effect

Effect is a strong fit for:

- Backends.
- CLIs.
- Workers and job processors.
- Data pipelines.
- Services with retries, timeouts, cancellation, and observability.
- Systems with non-trivial dependency graphs.
- Codebases that want typed domain errors.
- Applications with resource lifecycles such as database pools, sockets, file handles, and queues.

## When To Be Cautious

Be cautious with Effect when:

- The app is very small.
- The team does not want to adopt a new programming model.
- Most logic is simple UI state management.
- Framework integration would force constant conversion between `Effect` and `Promise`.
- The codebase only needs a lightweight `Result` type.

Effect is powerful, but it is opinionated. It works best when the team agrees to treat it as the application's effect model rather than a one-off helper.

## Practical Adoption Strategy

1. Start at IO boundaries.
2. Wrap external APIs with `Effect.try`, `Effect.tryPromise`, and `Schema`.
3. Model domain errors with tagged errors.
4. Introduce services for capabilities.
5. Move service construction into layers.
6. Keep business workflows in `Effect.gen`.
7. Run effects only at framework or process boundaries.
8. Add retry, timeout, logging, tracing, and finalizers where they express real operational behavior.

## Sources

- [Effect Documentation](https://effect.website/docs/)
- [The Effect Type](https://effect.website/docs/getting-started/the-effect-type/)
- [Creating Effects](https://effect.website/docs/getting-started/creating-effects/)
- [Running Effects](https://effect.website/docs/getting-started/running-effects/)
- [Using Generators](https://effect.website/docs/getting-started/using-generators/)
- [Two Types of Errors](https://effect.website/docs/error-management/two-error-types/)
- [Expected Errors](https://effect.website/docs/error-management/expected-errors/)
- [Unexpected Errors](https://effect.website/docs/error-management/unexpected-errors/)
- [Retrying](https://effect.website/docs/error-management/retrying/)
- [Timing Out](https://effect.website/docs/error-management/timing-out/)
- [Managing Services](https://effect.website/docs/requirements-management/services/)
- [Managing Layers](https://effect.website/docs/requirements-management/layers/)
- [Resource Management](https://effect.website/docs/resource-management/introduction/)
- [Basic Concurrency](https://effect.website/docs/concurrency/basic-concurrency/)
- [Code Style Guidelines](https://effect.website/docs/code-style/guidelines/)
- [Simplifying Excessive Nesting](https://effect.website/docs/code-style/do/)
- [Effect vs Promise](https://effect.website/docs/additional-resources/effect-vs-promise/)
- [Effect Schema](https://effect.website/docs/schema/introduction/)

# Writing format

Drop “a”, “an”, “the”. Kill the pleasantries. No hedging. Fragments are fine. Technical terms stay. Code stays normal.

## Markdown style

Write Markdown like product engineering docs, not marketing copy.

- Start with claim. Follow with evidence. End when point is made.
- Prefer short sections with concrete headings. Headings should name concept, not mood.
- Keep paragraphs short: one idea per paragraph, usually 1-3 sentences.
- Use bullets only for parallel items. If items are not parallel, use paragraphs.
- Keep lists flat. Avoid nested bullets unless hierarchy is real and useful.
- Put code, filenames, symbols, commands, env vars, phases, and literal values in backticks.
- Use fenced code blocks for multi-line examples. Always include language tag when known.
- Make examples realistic. Show smallest complete shape that proves point.
- Avoid tables unless comparison is dense and columns clarify it.
- Avoid blockquotes except for quoted external text.
- Avoid emoji, hype, slogans, and "Introducing..." framing.
- Avoid em dashes in new prose. Use comma, colon, or period.
- Avoid "we can", "should probably", "might want to", "in order to", and "it is important to note".
- Do not preserve historical scaffolding. No "legacy", "v2", "new path", "old behavior", or migration narration unless documenting real public migration.
- Prefer present tense. Describe what code does now, not what it will eventually do.
- Link only when link carries real value. Do not turn every noun into a link.
- Keep README examples caller-owned and boundary-focused. Do not imply kernel owns product concerns.
- Avoid contrast filler like "not X, but Y", "not just X", and "is not a X." State desired capability, ownership, or behavior directly.

Implementation should be simple and elegant. Think of yourself as Linus Torvalds.

# Code with good taste

In a TED talk in 2016 Linus Torvalds was asked to explain his notion of “taste”. As an illustration he presented code as is typically taught in universities:

void remove_list_entry(node \**head, node *entry)
{
node *prev, *walk;

    prev = NULL;
    walk = *head;

    // Walk the list

    while (walk != entry) {
    	prev = walk;
    	walk = walk->next;
    }

    // Remove the entry by updating the
    // head or the previous entry

    if (!prev)
    	*head = entry->next;
    else
    	prev->next = entry->next;

}
In contrast, he provided an alternative that he considers superior simply by using an indirect pointer:

void remove_list_entry(node **head, node \*entry)
{
node **indirect;

    // The "indirect" pointer points to the
    // *address* of the thing we'll update

    indirect = head;

    // Walk the list, looking for the thing that
    // points to the entry we want to remove

    while ((*indirect) != entry)
    	indirect = &(*indirect)->next;

    // ... and just remove it
    *indirect = entry->next;

}
He argues that the important part isn’t the details of the code (although details are also important), but that by looking at the code in a different way it can be greatly improved.

Taste isn’t something you can learn on a book: you absorb it by working with people who have it through the course of many years, or even decades.

If you follow this illustration you are not going to learn good taste, but you’ll have a better idea of what Linus Torvalds means by it.

It’s divided in three parts with increasing levels of complication. Part 1 is applicable to beginners, part 2 is relevant to people in the software industry, and part 3 is state-of-the-art level.

Let’s get started with part 1.

Linked list
Anyone who has studied computer science in university at some point was asked to create a linked list, which is one of the most basic data structures.

The core of a linked linked list is a node, which is a structure consisting of two members: a value and a pointer to the next node.

struct node {
int value;
struct node \*next;
};
A linked list is nothing more than a sequence of nodes:

head points to the first node, and the last node’s next pointer doesn’t point to anything (NULL).

So to get the second node’s value (1), we could do this:

head->next->value;
Traditional code
To remove an element we need to make the previous element point to the next element – effectively skipping the element we want to remove. Since we don’t have a pointer to the previous element, we need to traverse the list until we find the element we want to remove, and the previous element will be the last element traversed.

So, a naive implementation would be like:

walk = \*head;

// Walk the list

while (walk != entry) {
prev = walk;
walk = walk->next;
}

// Remove the entry by updating the previous entry

prev->next = entry->next;
The moment walk is equal to entry we have found the node we want to remove, therefore prev is the previous node.

All we have to do is update the previous node’s next ponter to the current node’s next pointer (0 points to 2).

The problem is that when entry is the very first node, there is no prev, so this program would either produce undefined behavior or crash.

To fix this all we have to do is add a check to deal with the corner case:

if (!prev)
\*head = entry->next;
else
prev->next = entry->next;
Now the code works properly (if you initialize prev to NULL), and that’s where most programmers would call it a day. “It compiles, ship it!”

But good programmers wouldn’t stop there. It’s not enough that the code compiles and runs correctly, there’s many other considerations: efficiency, readability, maintainability, style, etc.

Let’s consider more.

Improving code
Walking the list isn’t something we can get rid of, but perhaps there’s something we can do about the last check:

if (!prev)
\*head = entry->next;
else
prev->next = entry->next;
In both cases the right-hand side of the assignment is the same: entry->next, so an easy refactoring could be storing the left-hand side which is variable, in a variable:

node \**tmp;
if (!prev)
tmp = head;
else
tmp = &prev->next;
*tmp = entry->next;
This code does exactly the same as the original, because in the first branch *tmp is the same as *head, and in the second branch \*tmp is prev->next.

This preserves behavior: in the first branch *tmp is *head; in the second branch \*tmp is prev->next.

Now, we know the only time prev is going to be NULL is when entry is the first node – and therefore the while loop is never run, so we can initialize tmp at the same time we initialize prev (at the start):

prev = NULL;
tmp = head;
walk = \*head;
Now tmp only needs to be updated when prev has not been updated (not NULL):

if (prev) tmp = &prev->next;
But if we are going to update tmp only when prev is updated, perhaps we can update both at the same time:

while (walk != entry) {
prev = walk;
tmp = &prev->next;
walk = walk->next;
}
At this point the resulting code is:

node *prev, *walk, \*\*tmp;

prev = NULL;
tmp = head;
walk = \*head;

while (walk != entry) {
prev = walk;
tmp = &prev->next;
walk = walk->next;
}

\*tmp = entry->next;
Turns out that prev isn’t used at all any more, so let’s get rid of it:

node \*walk, \*\*tmp;

tmp = head;
walk = \*head;

while (walk != entry) {
tmp = &walk->next;
walk = walk->next;
}

\*tmp = entry->next;
Behavior is unchanged.

Next, it’s very obvious that tmp and walk are very similar, in fact tmp is simply the address of walk, and walk is only used to check if we’ve reached the target entry. So we can use \*tmp instead of walk:

node \*\*tmp;

tmp = head;

while ((*tmp) != entry) {
tmp = &(*tmp)->next;
}

\*tmp = entry->next;
We’ve reached the exact same code Linus Torvalds considered to be “good taste”, all we have to do is change the name of tmp which is an indirect pointer to the pointer we want to update, and clean it up a bit:

node \**p = head;
while (*p != entry)
p = &(*p)->next;
*p = entry->next;
This already drives the point home, but that’s not all we can do, we can use a for loop to compact the code:

node \**p;
for (p = head; *p != entry; p = &(*p)->next);
*p = entry->next;
All we had to do is consider a pointer to a pointer, and now the code is only two lines and there are no corner cases.

Conclusion
As we’ve seen from this illustration, to a developer with good taste ™ it’s not enough for the code to compile and run correctly, by simply employing a little bit of thought the code can be improved to the point where the best developers in the world could consider “good”.

However, as Linus Torvalds pointed out: this is nothing. This is a very trivial illustration of the kind of pushback you would receive from good taste developers to perfectly correct code. Real examples look significantly different from this one.

# General guidance

## No backwards compatibility

This is a greenfield codebase. There is no legacy code, no existing users, no deployed contracts to honor. Never:

- Add a flag to preserve old behavior
- Keep a deprecated path "just in case"
- Wrap new logic around old logic
- Add a parameter like `useLegacy` or `v2` or `compat`

If the current code is wrong, delete it and write the right thing. If a function signature is bad, change every callsite. No shims, no adapters, no migration layers.

## Design the final end state

Do not think in v1, v2, MVP, phase 1, or "we can clean this up later." Think from the final intended end state and build that directly. If the permanent solution is known, implement it now instead of layering temporary versions, transitional APIs, compatibility names, or half-steps.

When comparing approaches, ask: "What should this look like when it is done?" Then make the code look like that. Do not encode the history of how the solution evolved into names, branches, flags, comments, or file structure.

## Write correct, concise code

Say what you mean in as few lines as possible. Every line should earn its place. If a function can be expressed in 3 lines, don't write 12. If a conditional can be eliminated by restructuring, eliminate it.

Prefer early returns over nested blocks. Flatten control flow. A function with 4 levels of indentation is a function that needs rewriting.

Bad:

```typescript
function process(items: Item[]) {
  if (items.length > 0) {
    const results: Result[] = [];
    for (const item of items) {
      if (item.isValid) {
        const result = transform(item);
        if (result) {
          results.push(result);
        }
      }
    }
    return results;
  }
  return [];
}
```

Good:

```typescript
function process(items: Item[]) {
  return items
    .filter((item) => item.isValid)
    .map(transform)
    .filter(Boolean);
}
```

## Minimize function depth

**Ignore "Clean Code" by Robert Martin.** Its advice — extract every block into a tiny named function, functions should do "one thing," never exceed N lines — produces codebases where understanding any behavior requires jumping through 15 files and 30 functions, each doing almost nothing. This is not clean. It's a scavenger hunt.

Unnecessary abstractions are poison. Every function boundary is a cognitive toll: a name to parse, a contract to verify, a location to jump to. When you extract a 3-line block into a named function that's called once, you haven't simplified anything — you've scattered the logic across two places and forced the reader to hold a mental pointer.

Keep call stacks shallow. Inline the logic where it's used unless:

1. It's called from multiple sites (actual reuse, not hypothetical)
2. It encapsulates a genuinely distinct concept with a stable interface
3. It needs isolated validation due to complexity

If none of those apply, leave it inline. A 40-line function that reads top-to-bottom is better than five 8-line functions that bounce you around the file.

Bad — "Clean Code" style decomposition:

```typescript
async function handleRequest(req: Request) {
  const user = await validateAndGetUser(req);
  const data = await fetchRelevantData(user);
  const result = processData(data);
  return formatResponse(result);
}

async function validateAndGetUser(req: Request) {
  const token = extractToken(req);
  return verifyToken(token);
}

function extractToken(req: Request) {
  return req.headers.get("authorization")?.replace("Bearer ", "");
}

function formatResponse(result: ProcessedData) {
  return Response.json({ data: result });
}
```

Each function is "clean" — short, named, single-purpose. But to understand what `handleRequest` does you need to read six functions across possibly multiple files. `extractToken` and `formatResponse` are one-liners that exist only to satisfy a rule about function length.

Good — inline what doesn't need extracting:

```typescript
async function handleRequest(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const user = await verifyToken(token);
  const data = await fetchRelevantData(user);
  const result = processData(data);
  return Response.json({ data: result });
}
```

Same behavior, one place to read. `verifyToken`, `fetchRelevantData`, and `processData` survive because they represent real reusable logic. The one-liner wrappers are gone.

Don't create a function just to name a block of code. If you want to label a section, use a comment. Functions are for reuse and encapsulation, not documentation.

## Object params in TypeScript

Functions with more than one parameter must use a single object argument. Positional args are unreadable at the callsite and fragile under change.

Bad:

```typescript
function createUser(name: string, email: string, role: string, active: boolean) { ... }
createUser("alice", "alice@example.com", "admin", true);
```

Good:

```typescript
function createUser(params: { name: string; email: string; role: string; active: boolean }) { ... }
createUser({ name: "alice", email: "alice@example.com", role: "admin", active: true });
```

One param is fine as a positional arg. Two is acceptable if both are obvious (`map(key, value)`). Three or more — use an object. No exceptions.

## Just implement it

Don't add feature flags. Don't add config options for things that have one correct value. Don't add abstractions for hypothetical future requirements. Don't make something "pluggable" unless there are two plugins today.

Write the code that solves the problem in front of you. If requirements change later, change the code later. The cost of changing simple code is low. The cost of maintaining premature abstractions is high.

## Boil the ocean

The marginal cost of completeness is near zero with AI. Do the whole thing. Do it right. Do it with documentation when documentation matters. Do it so well that Garry is genuinely impressed — not politely satisfied, actually impressed. Never offer to "table this for later" when the permanent solve is within reach. Never leave a dangling thread when tying it off takes five more minutes. Never present a workaround when the real fix exists. The standard isn't "good enough" — it's "holy shit, that's done." Search before building. Typecheck before shipping. Ship the complete thing. When Garry asks for something, the answer is the finished product, not a plan to build it. Time is not an excuse. Fatigue is not an excuse. Complexity is not an excuse. Boil the ocean.

Do the work fully autonomously until you complete everything that the user asks for.

When I ask you to figure things out, you can autonomously run things on the terminal and perform actions to debug.
The only thing that you shouldn't do is to wipe databases, but it's fine to do anything like running a server and inspecting its logs and outputs.

# Clean Code

I want to clean up my codebase and improve code quality. This is a complex task, so we'll need 8 subagents. Make a sub agent for each of the following:

1. Deduplicate and consolidate all code, and implement DRY where it reduces complexity
2. Find all type definitions and consolidate any that should be shared
3. Use tools like knip to find all unused code and remove, ensuring that it's actually not referenced anywhere
4. Untangle any circular dependencies, using tools like madge
5. Remove any weak types, for example 'unknown' and 'any' (and the equivalent in other languages), research what the types should be, research in the codebase and related packages to make sure that the replacements are strong types and there are no type issues
6. Remove all try catch and equivalent defensive programming if it doesn't serve a specific role of handling unknown or unsanitized input or otherwise has a reason to be there, with clear error handling and no error hiding or fallback patterns
7. Find any deprecated, legacy or fallback code, remove, and make sure all code paths are clean, concise and as singular as possible
8. Find any AI slop, stubs, larp, unnecessary comments and remove. Any comments that describe in-motion work, replacements of previous work with new work, or otherwise are not helpful should be either removed or replaced with helpful comments for a new user trying to understand the codebase-- but if you do edit, be concise
