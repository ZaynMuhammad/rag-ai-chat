import { Effect, Exit, Schema } from "effect";
import type { NextRequest } from "next/server";
import { SearchQuery } from "@/server/search/SearchProtocol";
import { SearchResults } from "@/server/search/SearchResults";
import { runtime } from "@/server/runtime";

const decodeSearchQuery = Schema.decodeUnknownExit(SearchQuery);

export async function GET(request: NextRequest) {
  const decoded = decodeSearchQuery({
    q: request.nextUrl.searchParams.get("q"),
  });
  if (Exit.isFailure(decoded)) {
    return Response.json(
      { message: "Search needs a q parameter of 1 to 500 characters" },
      { status: 400 },
    );
  }
  const { results, assist } = await runtime.runPromise(
    Effect.flatMap(SearchResults, (search) => search.search(decoded.value.q)),
  );
  return Response.json(
    { results, assist },
    { headers: { "cache-control": "no-store" } },
  );
}
