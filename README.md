<img src="assets/icon.svg" width="64" height="64" alt="">

# rag-ai-chat

Explore Wikipedia's video game articles on a globe of the studios that made them, and ask questions that are answered only from those articles, with numbered citations. No accounts, no cookies, no request logs.

- **Explore** 24,887 games with article text on a globe. Each pin is a studio's headquarters city; games whose studio city isn't on Wikidata sit on their country instead. Click a pin to list its games with genre and release year.
- **Read** a game's article in a dialog, linked to the exact Wikipedia revision it came from.
- **Ask** about that one game beside its article, or about every game from the main chat box. Each answer streams with `[n]` citations that open the passage they came from, and names the model that wrote it. Past chats are listed in the sidebar and saved only in the browser.

## Numbers

Measured on a 2-core VPS. Reproduce with the commands in [Evals and load](#evals-and-load).

| Corpus                                                      |         |
| ----------------------------------------------------------- | ------- |
| Video games with an English article and a country of origin | 26,937  |
| With article text                                           | 24,887  |
| With a release date (Wikidata P577)                         | 25,638  |
| With a studio city (developer's HQ, P178 → P159)            | 16,306  |
| With a genre (P136)                                         | 25,221  |
| Passages                                                    | 162,346 |

| Retrieval eval: 160 frozen questions (HotpotQA, KILT NQ, hand-written) | full BM25 (default) | require a distinctive word |
| ---------------------------------------------------------------------- | ------------------- | -------------------------- |
| hit@5                                                                  | 0.669               | 0.656                      |
| hit@20                                                                 | 0.825               | 0.825                      |
| MRR                                                                    | 0.510               | 0.498                      |
| Retrieval p50 / p99                                                    | 207 / 412 ms        | 109 / 410 ms               |

| Load: 4 chats/s for 60 s, production build, mock provider | full BM25              | require a distinctive word |
| --------------------------------------------------------- | ---------------------- | -------------------------- |
| Errors                                                    | 0                      | 0                          |
| Time to first token p50 / p95 / p99                       | 992 / 7,608 / 8,969 ms | 117 / 436 / 608 ms         |

## How it works

```text
Wikidata SPARQL ──► 26,937 games: country of origin ──► UN M49 region
               └──► earliest release date (P577), kept at its precision
wikimedia/structured-wikipedia ──► sections ──► passages (≤ 400 tokens) ──► SQLite + FTS5

question + scope (region, years, or one game)
  ──► anonymous session check and rate limit
  ──► BM25 over passages in scope (top 6)
  ──► Citations event ──► model stream ──► Delta events ──► Done { model }
```

- **Corpus.** [`src/corpus`](src/corpus) and [`scripts/corpus`](scripts/corpus) build `data/corpus/games.sqlite`. Wikidata picks the games, their countries of origin, their developers' headquarters cities, and their genres. A headquarters that is a whole country is dropped, so the game falls back to its country pin. UN M49 turns a country into a region. Wikimedia's pre-parsed `structured-wikipedia` dump supplies the text, joined on Wikidata QID, so renames and redirects don't matter.
- **Release dates** keep the precision Wikidata states, so a game known only by year shows "1985", not "1 Jan 1985". Truncated ISO dates sort correctly as plain strings.
- **Retrieval** is BM25 in SQLite FTS5 (porter stemming, diacritics folded), filtered by the chat's scope. It reads the corpus through `node:sqlite`, so there is no native addon. [`Retriever.ts`](src/server/search/Retriever.ts)
- **Grounded chat** sends the retrieved passages first, then streams the answer. Providers form an Effect `ExecutionPlan`: if one fails before its first token, the next takes over; once tokens have streamed, a failure is reported rather than restarted. When nothing in scope matches, it says so without calling a model. [`GroundedChat.ts`](src/server/chat/GroundedChat.ts)
- **Providers.** With no `ANTHROPIC_API_KEY`, the only provider is `mock-extractive`, which quotes the best-matching retrieved sentences with citations. Dev, tests, and load tests never spend money. With a key, Claude Haiku 5.5 answers at low effort, and the mock is the fallback.

## Privacy

- **No identity.** Rate limits use anonymous session tokens: 128 random bits and an expiry, signed with HMAC. The browser holds the token in memory, not in a cookie, and it expires after 30 minutes.
- **Chats stay on the device.** The sidebar's chat history lives in the browser's `localStorage`. The server never receives the list.
- **No logs.** Nothing logs or stores an IP, user agent, token, or question. Lint rejects code that reads identifying headers.
- **Bounded abuse.** Each token gets 10 chats a minute. Global caps on chats and on new tokens bound abuse without knowing who anyone is.
- **Clean errors.** Provider errors never echo the question back to the client. A test checks this.

## Run it

Requires Bun 1.3 and Node 24.

```sh
bun install
bun run corpus:build         # about 20 minutes and 37 GB streamed; keeps a 300 MB SQLite file in data/
bun run dev                  # http://localhost:3000
```

| Environment variable          | Default                    | Effect                                                                                    |
| ----------------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`           | unset                      | Unset: the free extractive mock answers. Set: Claude answers.                             |
| `ANTHROPIC_MODEL`             | `claude-haiku-5-5`         | Model used when a key is set                                                              |
| `RETRIEVAL_COMMON_WORD_SHARE` | unset                      | e.g. `0.1`: every match needs a word found in under 10% of passages (faster, see Numbers) |
| `SESSION_SECRET`              | random per process         | HMAC key for session tokens; set it when running more than one process                    |
| `CORPUS_DATABASE`             | `data/corpus/games.sqlite` | Corpus location                                                                           |

## Evals and load

```sh
bun run evals:check          # every frozen question still resolves to passages in the corpus
bun run evals:retrieval      # hit@k, article recall, MRR, latency; writes evals/games/results/retrieval.json
bun run build && bun run start &
LOAD_BASE_URL=http://localhost:3000 LOAD_RPS=4 LOAD_SECONDS=60 bun run load:steady
```

The Go load generator in `loadgen/` sends the same chats from one static binary (`bun run load:go` builds it):

```sh
bun run load:go steady -url http://localhost:3000 -rate 4 -duration 60s   # same traffic as load:steady
bun run load:go steady -url http://localhost:3000 -rate 4 -poisson -seed 7   # exponential gaps, reproducible
bun run load:go spike -url http://localhost:3000 -rate 4 -multiplier 5 -spike-at 20s -spike-for 10s
bun run load:go zipf -url http://localhost:3000 -rate 4 -s 1.1 -seed 7   # question k is asked with weight 1/k^s
bun run load:go steady -url http://localhost:3000 -json > run.json   # summary and 5 s buckets as JSON
```

It is an open-model generator: every chat fires at its scheduled time whether or not earlier ones have finished, and time to first token (the first `Delta` event) and total time are measured from that scheduled time. That corrects for coordinated omission, where a stalled server or a full client quietly delays sends and hides the wait. The report prints the naive from-send timings and the send lag next to the corrected ones. `-max-inflight N` caps concurrency like a fixed connection pool, which is where the two diverge. Errors are split into HTTP status, `Failed` events, timeouts and transport errors. Percentiles come from sorting every sample, which is exact and cheap for a few thousand chats. Each session token carries at most 8 chats a minute, under the gateway's limit of 10, and a new one is minted only when every token is spent. The outage scenario is `steady` against a server started with `MOCK_PRIMARY` from the failover change; the `models` line shows which model answered.

## Checks

`bun run check` runs Prettier, ESLint (strict type-checked rules, plus project rules: no comments, no reading identifying headers, no real time in tests), `tsc` with the Effect language service, and the Vitest suite. CI runs the same checks plus `next build` on every push and pull request. Tests use an in-memory SQLite corpus, `TestClock`, and the mock provider, and they fail if anything tries to reach the network.

## Licensing

Article text is from Wikipedia under CC BY-SA 4.0. Every game page links the revision it shows. Wikidata statements are CC0. Region names are from the UN M49 standard.
