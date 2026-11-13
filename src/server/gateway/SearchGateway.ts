import { Effect, Exit, Schema } from "effect";
import { SearchQuery } from "@/server/search/SearchProtocol";
import { SearchResults } from "@/server/search/SearchResults";
import { AnonymousSessions } from "./AnonymousSessions";
import { refusal } from "./responses";

const decodeSearchQuery = Schema.decodeUnknownExit(SearchQuery);

export const admittedSearch = Effect.fn("SearchGateway.admittedSearch")(
  function* (query: string) {
    const sessions = yield* AnonymousSessions;
    const results = yield* SearchResults;
    yield* sessions.admitSearch;
    return yield* results.search(query);
  },
);

export const serveSearch = Effect.fn("SearchGateway.serveSearch")(function* (
  q: string | null,
) {
  const decoded = decodeSearchQuery({ q });
  if (Exit.isFailure(decoded)) {
    return Response.json(
      { message: "Search needs a q parameter of 1 to 500 characters" },
      { status: 400 },
    );
  }
  return yield* admittedSearch(decoded.value.q).pipe(
    Effect.map(({ results, assist }) =>
      Response.json(
        { results, assist },
        { headers: { "cache-control": "no-store" } },
      ),
    ),
    Effect.catchTag("RateLimited", (error) => Effect.succeed(refusal(error))),
  );
});
