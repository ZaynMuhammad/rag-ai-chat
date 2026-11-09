<img src="assets/icon.svg" width="64" height="64" alt="">

# rag-ai-chat

Browse Wikipedia's video game articles by region and release date, and ask questions that are answered only from those articles, with numbered citations. No accounts, no cookies, no request logs.

- **Browse** 24,887 games with article text, filtered by UN M49 region or sub-region and release years, sorted by release date.
- **Read** each game's article passages, linked to the exact Wikipedia revision they came from.
- **Ask** about one game, or about every game from a region and era. Each answer streams with `[n]` citations that link to the passage they came from, and names the model that wrote it.

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

| Answer eval: 180 frozen questions through Retriever + `GroundedChat`, `mock-extractive` | all       | HotpotQA  | KILT NQ   | hand-written |
| --------------------------------------------------------------------------------------- | --------- | --------- | --------- | ------------ |
| A gold passage is among the 6 sent                                                      | 0.681     | 0.836     | 0.507     | 0.833        |
| Answer contains a gold answer                                                           | 0.356     | 0.400     | 0.240     | 0.567        |
| Answer token F1                                                                         | 0.027     | 0.024     | 0.020     | 0.048        |
| Citation precision (cited passages holding gold evidence)                               | 0.308     | 0.345     | 0.200     | 0.506        |
| Citation recall (gold articles cited)                                                   | 0.694     | 0.527     | 0.727     | 0.917        |
| Citation validity / uncited sentences / lexical faithfulness                            | 1 / 0 / 1 | 1 / 0 / 1 | 1 / 0 / 1 | 1 / 0 / 1    |
| Says "not covered" on the 20 unanswerable questions                                     | 0.200     |           |           | 0.200        |
| Says "not covered" on an answerable question                                            | 0.006     | 0         | 0.013     | 0            |

The extractive mock quotes retrieved sentences verbatim and cites each one, so citation validity, uncited sentences, and lexical faithfulness sit at their ceilings by construction. They are there to catch a real model. Token F1 is low because the mock answers with whole sentences, not short spans. `EVAL_JUDGE=anthropic` adds a claim-by-claim LLM judge for faithfulness. [`AnswerMetrics.ts`](src/evals/AnswerMetrics.ts), [`FaithfulnessJudge.ts`](src/evals/FaithfulnessJudge.ts)

| Load: 4 chats/s for 60 s, production build, mock provider | full BM25              | require a distinctive word |
| --------------------------------------------------------- | ---------------------- | -------------------------- |
| Errors                                                    | 0                      | 0                          |
| Time to first token p50 / p95 / p99                       | 992 / 7,608 / 8,969 ms | 117 / 436 / 608 ms         |

| Outage: 4 chats/s for 60 s, production build; the primary hangs at 15 s, fails at 30 s, recovers at 45 s | before: retry every request | circuit breaker + 2 s first-token deadline       |
| -------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------ |
| Errors                                                                                                   | 26.3%, all stuck past 30 s  | 0                                                |
| While the primary hangs (15–30 s)                                                                        | 59 of 60 requests stuck     | all answered; TTFT p50 3.4 s for 5 s, then 0.2 s |
| While the primary fails (30–45 s), TTFT p50 per 5 s                                                      | 1.4–2.3 s                   | 0.16–0.18 s                                      |
| Back on the primary after it recovers                                                                    | at once                     | after the 10 s cooldown                          |

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

- **Corpus.** [`src/corpus`](src/corpus) and [`scripts/corpus`](scripts/corpus) build `data/corpus/games.sqlite`. Wikidata picks the games, their countries of origin, their developers' headquarters cities, and their genres. A headquarters that is a whole country is dropped, so the game falls back to its country. UN M49 turns a country into a region. Wikimedia's pre-parsed `structured-wikipedia` dump supplies the text, joined on Wikidata QID, so renames and redirects don't matter.
- **Release dates** keep the precision Wikidata states, so a game known only by year shows "1985", not "1 Jan 1985". Truncated ISO dates sort correctly as plain strings.
- **Retrieval** is BM25 in SQLite FTS5 (porter stemming, diacritics folded), filtered by the same scope as browsing. It reads the corpus through `node:sqlite`, so there is no native addon. [`Retriever.ts`](src/server/search/Retriever.ts)
- **Grounded chat** sends the retrieved passages first, then streams the answer. When nothing in scope matches, it says so without calling a model. [`GroundedChat.ts`](src/server/chat/GroundedChat.ts)
- **Failover.** Providers form an Effect `ExecutionPlan`. A provider that fails, or sends no token within `FIRST_TOKEN_TIMEOUT` (2 s), hands over to the next; once tokens have streamed, a failure is reported rather than restarted. A per-provider circuit breaker opens after 5 consecutive failures or half the calls in 30 s, and requests then skip that provider without calling it. After 10 s one probe goes through, and a success closes it. The last provider in the plan is never cut off, since nothing is left to fail over to. State is in memory, per process, and labeled only by provider. [`CircuitBreaker.ts`](src/server/provider/CircuitBreaker.ts)
- **Providers.** With no keys, the only provider is `mock-extractive`, which quotes the best-matching retrieved sentences with citations. Dev, tests, and load tests never spend money. With `ANTHROPIC_API_KEY`, Claude Haiku 5.5 answers at low effort. With `OPENAI_MODEL`, any OpenAI-compatible endpoint joins the plan: OpenAI, Groq, Together, or a local Ollama. The mock is always the last fallback. `GET /api/models` lists the configured models in fallback order, and a chat may pick one with `model`: it goes first, and the rest stay as fallback. [`ChatModels.ts`](src/server/provider/ChatModels.ts)

## Privacy

- **No identity.** Rate limits use anonymous session tokens: 128 random bits and an expiry, signed with HMAC. The browser holds the token in memory, not in a cookie, and it expires after 30 minutes.
- **No logs.** Nothing logs or stores an IP, user agent, token, or question. Lint rejects code that reads identifying headers.
- **Bounded abuse.** Each token gets 10 chats a minute. Global caps on chats and on new tokens bound abuse without knowing who anyone is.
- **Clean errors.** Provider errors never echo the question back to the client. A test checks this.

## Pro without identity

Paying for Pro should not make you identifiable. Pro access uses RSA blind signatures ([RFC 9474](https://www.rfc-editor.org/rfc/rfc9474), variant RSABSSA-SHA384-PSS-Deterministic), the same idea as Privacy Pass.

1. **Get credentials.** On [`/pro`](src/app/pro/page.tsx) you paste an access code. Your browser makes 10 random 32-byte messages and blinds each one by multiplying in a random factor only it knows. It sends the code and the blinded messages. The server checks the code, signs the blinded messages, and returns the signatures. It never sees the real messages.
2. **Unblind.** The browser removes its factors, which leaves ordinary RSA-PSS signatures on the real messages. It checks each one against the published key and keeps them in `localStorage`.
3. **Spend one per session.** When the chat needs a new session, the browser sends one message and its signature to `POST /api/session`. The server checks the signature, records a hash of the message so it can't be used twice, and returns a session token marked `pro`: 60 chats a minute instead of 10, under its own global cap.

The server sees a code and some blinded numbers at step 1, and a message and a signature at step 3. Every blinded number it ever signed matches every credential it is shown equally well, so it can't tell whose credential it is. A test checks exactly this.

```text
Browser                                   Server
   │  GET /api/pro/keys                      │
   │◄──────────────── key id, public key ─────│  key id = SHA-256(SPKI)
   │  m₁…m₁₀ random; bᵢ = blind(mᵢ, rᵢ)       │
   │  POST /api/pro/credentials              │
   │  { code, key id, b₁…b₁₀ } ──────────────►│  check code, quota per code
   │◄──────────────────────── s'₁…s'₁₀ ───────│  s'ᵢ = bᵢ^d mod n
   │  sᵢ = finalize(s'ᵢ, rᵢ); verify          │
   │                                          │
   │        … later, any number of sessions … │
   │  POST /api/session { key id, mᵢ, sᵢ } ──►│  verify; SHA-256(mᵢ) not spent → record it
   │◄──────────────── token (tier: pro) ──────│
```

| Variable                  | Default               | Effect                                                                                    |
| ------------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `PRO_ACCESS_CODES`        | unset (no Pro access) | Comma-separated dev access codes. Stands in for a billing check.                          |
| `PRO_SIGNING_KEY`         | random 2048-bit key   | PEM RSA private keys, newest first. The first one signs; all of them verify.              |
| `PRO_SIGNING_KEY_EXPIRES` | 7 days from start     | One ISO date per key, comma-separated. Credentials stop verifying after their key's date. |

`bun run bench:pro` times each step.

## Run it

Requires Bun 1.3 and Node 24.

```sh
bun install
bun run corpus:build         # about 20 minutes and 37 GB streamed; keeps a 300 MB SQLite file in data/
bun run dev                  # http://localhost:3000
```

| Environment variable          | Default                     | Effect                                                                                    |
| ----------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`           | unset                       | Unset: the free extractive mock answers. Set: Claude answers.                             |
| `ANTHROPIC_MODEL`             | `claude-haiku-5-5`          | Model used when a key is set                                                              |
| `OPENAI_MODEL`                | unset                       | Set: an OpenAI-compatible model joins the plan, e.g. `gpt-5-mini` or `llama3.2:3b`        |
| `OPENAI_BASE_URL`             | `https://api.openai.com/v1` | e.g. `https://api.groq.com/openai/v1` or `http://localhost:11434/v1` for Ollama           |
| `OPENAI_API_KEY`              | unset                       | Bearer key for that endpoint; Ollama needs none                                           |
| `FIRST_TOKEN_TIMEOUT`         | `2 seconds`                 | How long a provider may take to send its first token before the next one takes over       |
| `MOCK_PRIMARY`                | unset                       | e.g. `ok@15,hang@15,outage@15,ok`: a scheduled mock ahead of the others, for load tests   |
| `RETRIEVAL_COMMON_WORD_SHARE` | unset                       | e.g. `0.1`: every match needs a word found in under 10% of passages (faster, see Numbers) |
| `SESSION_SECRET`              | random per process          | HMAC key for session tokens; set it when running more than one process                    |
| `CORPUS_DATABASE`             | `data/corpus/games.sqlite`  | Corpus location                                                                           |

## Evals and load

```sh
bun run evals:check          # every frozen question still resolves to passages in the corpus
bun run evals:retrieval      # hit@k, article recall, MRR, latency; writes evals/games/results/retrieval.json
bun run evals:answers        # answer, citation, faithfulness and abstention metrics; writes evals/games/results/answers.json
bun run evals:answers --check  # fails if any metric drops more than 0.02 in a group of 20+ questions
EVAL_PROVIDER=anthropic EVAL_LIMIT=30 bun run evals:answers --estimate  # cost ceiling for a real-model run, no calls made
bun run build && bun run start &
LOAD_BASE_URL=http://localhost:3000 LOAD_RPS=4 LOAD_SECONDS=60 bun run load:steady
MOCK_PRIMARY=ok@15,hang@15,outage@15,ok bun run start &   # restart with a misbehaving primary
LOAD_BASE_URL=http://localhost:3000 bun run load:outage   # per-5 s buckets: errors, TTFT, which model answered
LOAD_BASE_URL=http://localhost:3000 bun run load:spike    # 4 chats/s with a 10 s burst at 5x
```

## Checks

`bun run check` runs Prettier, ESLint (strict type-checked rules, plus project rules: no comments, no reading identifying headers, no real time in tests), `tsc` with the Effect language service, and the Vitest suite. CI runs the same checks plus `next build` on every push and pull request. Tests use an in-memory SQLite corpus, `TestClock`, and the mock provider, and they fail if anything tries to reach the network.

## Licensing

Article text is from Wikipedia under CC BY-SA 4.0. Every game page links the revision it shows. Wikidata statements are CC0. Region names are from the UN M49 standard.
