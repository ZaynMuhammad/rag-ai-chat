# rag-ai-chat

rag-ai-chat is an anonymous AI chat gateway. A Next.js app on bun serves the chat UI and the gateway API. The gateway strips anything that identifies a user, rate limits without accounts, streams responses from multiple LLM providers, and fails over when one goes down. An optional grounded mode retrieves Wikipedia passages and answers with citations.

The project exists to show backend work that holds up under load, and to prove it with numbers: load tests, latency percentiles, and evals.

## What we never compromise on

### 1. Private by default

No IP addresses, no cookies that follow a user, no request logs tied to a person. Rate limits use anonymous tokens that cannot be linked back to a user. Caches are keyed on the normalized query, never on who asked. If a feature needs to know who someone is, it does not ship.

### 2. Performance you can prove

Every claim about scale comes from a load test, not a guess. Watch time to first token, retrieval p99, cache hit rate, and error rate. A change that makes those worse needs a reason.

### 3. Grounded and honest

Grounded answers cite the passages they used. Evals measure retrieval recall, citation accuracy, and faithfulness. A change that makes them worse fails the build.

### 4. Cheap to run

Load tests and local dev hit a mock LLM provider. Embeddings run locally. Real provider calls are for evals and manual checks only, on the cheapest model that answers the question.

## A note on approach

Prefer simple systems and software that feels obvious. Do not add machinery because it looks architecturally impressive. Understand the real constraint, then build the smallest thing that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Honor the developer's intent in a minimal and realistic way.

Treat the rest of this document as good defaults, not hard rules. The developer's preferences override anything here.

## A small glossary

- **you** means the agent reading this file and changing rag-ai-chat.
- **we** and **the developer** mean the person building rag-ai-chat.
- **user** means a person chatting through the app.
- **gateway** means the server path every chat request takes: token check, rate limit, routing, streaming.
- **provider** means an upstream LLM API, such as Anthropic or OpenAI. The **mock provider** is the fake one used in dev and load tests.
- **grounded mode** means a chat turn that retrieves Wikipedia passages before calling the provider.
- **passage** means one retrieved chunk of a Wikipedia article. A **citation** points an answer back to a passage.
- **session token** means the anonymous, rotating token used for rate limits. It carries no identity.
- **eval** means a scored run of a fixed question set against the real pipeline.
- **load scenario** means a scripted traffic pattern, such as a steady ramp, a spike, or a provider outage.

## The three ways to hurt yourself

1. **Logging people.** Never log, persist, or emit metrics labeled with an IP, user agent, session token, or raw query tied to a request. Aggregate counts are fine. If you need to debug, use the mock provider and synthetic traffic.
2. **Spending real money.** Never point tests or load scenarios at a real provider. A load test against a paid API can burn through the budget in minutes. Use the mock provider, and pick the cheapest model when a real call is truly needed.
3. **Killing by pattern.** Never `pkill -f` or kill a PID you found by matching a name or path. Other dev servers run on this machine. Kill only a PID you captured when you started it.

## Dev

- `bun install` installs.
- `bun run dev` starts the Next.js dev server.
- `bun run build` builds for production.
- Stop what you started, by the PID you tracked.

## Verifying

- Before you push, run `bun run lint`, `bun run typecheck`, and `bun run build`.
- Backend behavior changes ship with focused tests for that behavior.
- Test behavior that can break: rate limiting, token rotation, provider failover, stream translation, retrieval ranking, cache keys, and anything that touches privacy. Leave out tests for what types already guarantee and trivial wiring.
- Test at the lowest layer that fails without your change. Do not repeat the case in a wrapper test.
- Bug fixes get a failing test first, then the fix.
- Never wait on sleeps or polling in tests. Use `TestClock`, await a `Deferred`, or take from a `Queue`. A test that needs a timeout to pass is wrong.
- Tests that call a real provider are wrong. Use the mock provider.

## Pull requests

- Never make a PR unless the developer explicitly asks.
- Aim for PRs under 1500 changed lines. Lockfiles, generated files, and `.repos/` syncs do not count. If the work grows past that, split it into stacked PRs that each build and pass checks on their own.
- Conventional commit titles, plain language: `feat(gateway): fail over to backup provider on 5xx`.
- Body: the problem in a sentence or two, then how you fixed it. Performance changes include before and after numbers from the same load scenario.
- UI changes need before and after images.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary material outside the repo.
- A merged PR is the implementation record. Do not keep a second checklist in the repository.

## Where code lives

- `src/app` - Next.js App Router pages, layouts, and route handlers.
- `.repos/effect` - Effect 4 source, vendored as a squashed git subtree at the tag matching the installed `effect` version. Start from `.repos/effect/LLMS.md` when you need an Effect API you haven't checked yet. Prefer its patterns over invented ones. Never edit or import from it. When you bump `effect`, resync the subtree to the matching tag.
- `.repos/three` - three.js source at the `rN` tag matching the installed `three` version (`0.187.0` is `r187`), as a squashed subtree pruned to `src/`, `docs/**/*.md`, `examples/jsm/**/*.js`, `llms.txt`, `LICENSE`, `README.md`, and `package.json`. The full tree is about 600 MB of example assets. Look up the class you're using in `docs/pages/<Class>.html.md`. Never edit or import from it. To resync, fetch the new tag, build a commit holding only those paths with `git update-index --index-info`, `git write-tree`, and `git commit-tree`, then `git subtree merge --squash --prefix .repos/three <commit>`.

### Using `.repos/`

The subtrees are large. Read from them only when it answers a question in front of you, so they don't bloat your context.

Read `.repos/` when:

- You're writing Effect code with a module or function you haven't checked this session, such as a new Schema combinator, Layer, or Stream API. Start from `.repos/effect/LLMS.md` and open only the file it points to.
- You're using a three.js class, addon, or option you haven't checked this session. Open only `.repos/three/docs/pages/<Class>.html.md`.
- A type error or runtime behavior from Effect or three.js contradicts what you expected. Read the source for that one symbol.
- You're moving code off Effect 3 patterns. This is the only time to read `MIGRATION.md` or `migration/`.
- You're bumping `effect` or `three`, to resync the subtree or check what changed in an API you already use.

Don't read `.repos/`:

- At the start of a session, or for general context.
- For work that doesn't call the library, such as CSS, layout, copy, config, git, or routes that don't touch Effect or three.js.
- For anything you've already read this session.
- By grepping across a whole subtree or opening many files to explore. Look up the one symbol by its path.
- In `.agents/`, `packages/*/CHANGELOG.md`, or packages this project doesn't use (`sql`, `atom`, `opentelemetry`, `vitest`, `tools`). `.agents/` is upstream's instructions for working on Effect itself, not on this app.

## Taste

- Effect 4 differs from Effect 3, and from what you remember. Check `.repos/effect` for the real API of anything you haven't already checked before you use it.
- Server features are Effect services. Route handlers stay thin: decode input with Schema, call one service method, and map errors to responses.
- Complexity belongs at the provider and retrieval boundaries. The gateway core stays small and predictable.
- Reusable Effect functions use `Effect.fn("Service.operation")` with a stable span name. Keep `Effect.gen` for inline programs and layer construction.
- Anything crossing the wire is typed with Effect Schema.
- Inferred types over annotations. `any` is the enemy.
- No code comments. Make the code explain itself through clear names, small functions, and straightforward structure. Comments drift and mislead. Tool directives such as `eslint-disable` or `@ts-expect-error` are fine when unavoidable.
- React effects are for synchronizing with something outside React. Derive in render and act in handlers instead of syncing state.
- If a rule here fights the task in front of you, say so loudly and get sign-off before breaking it.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
