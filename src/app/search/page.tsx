import { Effect, Exit, Schema } from "effect";
import type { Metadata } from "next";
import { Suspense } from "react";
import { runAtRequestTime } from "@/app/run";
import type { SearchParams } from "@/app/params";
import { AssistAnswer } from "@/components/AssistAnswer";
import { SearchResultList } from "@/components/SearchResultList";
import { Button } from "@/components/ui/button";
import { SearchQuery } from "@/server/search/SearchProtocol";
import { SearchResults } from "@/server/search/SearchResults";

export const metadata: Metadata = {
  title: "Search · Game Atlas",
  referrer: "no-referrer",
};

const decodeSearchQuery = Schema.decodeUnknownExit(SearchQuery);

const queryOf = (params: SearchParams) => {
  const value = params["q"];
  const decoded = decodeSearchQuery({
    q: Array.isArray(value) ? value[0] : value,
  });
  return Exit.isSuccess(decoded) ? decoded.value.q : "";
};

function SearchBox({ query }: { query: string }) {
  return (
    <form action="/search" role="search" className="flex gap-2">
      <input
        type="search"
        name="q"
        defaultValue={query}
        maxLength={500}
        placeholder="Search the game articles"
        aria-label="Search"
        className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <Button type="submit" size="lg" className="px-4">
        Search
      </Button>
    </form>
  );
}

function NoAssist({ confidence }: { confidence: number }) {
  return (
    <p className="text-xs text-muted-foreground">
      No AI answer: the top passages don&apos;t clearly answer this (
      {Math.round(confidence * 100)}% retrieval confidence). The results are
      below.
    </p>
  );
}

async function Results({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = queryOf(await searchParams);
  if (query === "") {
    return (
      <>
        <SearchBox query="" />
        <p className="mt-4 text-sm text-muted-foreground">
          Search Wikipedia&apos;s video game articles. When the top passages
          clearly answer the question, an AI answer with citations appears above
          the results.
        </p>
      </>
    );
  }
  const page = await runAtRequestTime(
    Effect.flatMap(SearchResults, (search) => search.search(query)),
  );
  return (
    <>
      <SearchBox query={query} />
      <div className="mt-6 space-y-6">
        {page.assist.show ? (
          <AssistAnswer
            key={query}
            question={query}
            confidence={page.assist.confidence}
          />
        ) : (
          page.results.length > 0 && (
            <NoAssist confidence={page.assist.confidence} />
          )
        )}
        <SearchResultList results={page.results} />
      </div>
    </>
  );
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Searching…</p>}
      >
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
