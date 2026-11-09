import { Effect } from "effect";
import Link from "next/link";
import { Suspense } from "react";
import { AreaOptions } from "@/components/AreaSelect";
import { formatReleased } from "@/lib/release";
import {
  areaValue,
  browseQueryFromParams,
  queryString,
  type SearchParams,
} from "@/app/params";
import {
  type BrowsePage,
  type BrowseQuery,
  GameCatalog,
  type SubRegionCount,
} from "@/server/games/GameCatalog";
import { runAtRequestTime } from "@/app/run";

const field =
  "h-9 rounded-md border border-line bg-card px-2 text-sm outline-none focus:border-accent";

function Filters({
  query,
  subRegions,
}: {
  query: BrowseQuery;
  subRegions: ReadonlyArray<SubRegionCount>;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3" action="/">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Region
        <select name="area" defaultValue={areaValue(query)} className={field}>
          <AreaOptions subRegions={subRegions} />
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Released from
        <input
          name="from"
          type="number"
          min={1940}
          max={2100}
          placeholder="1940"
          defaultValue={query.from}
          className={`${field} w-24`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        to
        <input
          name="to"
          type="number"
          min={1940}
          max={2100}
          placeholder="2026"
          defaultValue={query.to}
          className={`${field} w-24`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Sort
        <select name="sort" defaultValue={query.sort} className={field}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">Title A–Z</option>
        </select>
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
        Title contains
        <input
          name="title"
          type="search"
          placeholder="Mario, Tetris, Doom…"
          defaultValue={query.title}
          className={field}
        />
      </label>
      <button
        type="submit"
        className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-white"
      >
        Apply
      </button>
    </form>
  );
}

function Results({ page, query }: { page: BrowsePage; query: BrowseQuery }) {
  const scope = queryString({
    ...(query.region === undefined ? {} : { region: query.region }),
    ...(query.subRegion === undefined ? {} : { subRegion: query.subRegion }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
  });
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted">
          {page.total.toLocaleString("en")} games with article text
        </p>
        <Link
          href={`/chat${scope}`}
          className="text-sm font-medium text-accent hover:underline"
        >
          Ask about these games →
        </Link>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {page.games.map((game) => (
          <li key={game.qid}>
            <Link
              href={`/games/${game.qid}`}
              className="block h-full rounded-lg border border-line bg-card p-4 hover:border-accent"
            >
              <p className="text-xs font-medium text-accent">
                {formatReleased(game.released)}
              </p>
              <h2 className="mt-1 font-semibold leading-snug break-words">
                {game.title}
              </h2>
              <p className="mt-1 text-xs text-muted">
                {game.countries.join(", ")} · {game.subRegions.join(", ")}
              </p>
              {game.description !== null && (
                <p className="mt-2 line-clamp-2 text-sm text-muted">
                  {game.description}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {page.games.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          No games match. Widen the years or pick another region.
        </p>
      )}
      <nav className="mt-6 flex items-center justify-between text-sm">
        {page.page > 1 ? (
          <Link
            href={`/${queryString({ ...query, page: page.page - 1 })}`}
            className="hover:text-accent"
          >
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="text-muted">
          Page {page.page} of {page.pageCount.toLocaleString("en")}
        </span>
        {page.page < page.pageCount ? (
          <Link
            href={`/${queryString({ ...query, page: page.page + 1 })}`}
            className="hover:text-accent"
          >
            Next →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </section>
  );
}

async function Browse({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = browseQueryFromParams(await searchParams);
  const [page, subRegions] = await runAtRequestTime(
    Effect.flatMap(GameCatalog, (catalog) =>
      Effect.all([catalog.browse(query), catalog.subRegions]),
    ),
  );
  return (
    <>
      <Filters query={query} subRegions={subRegions} />
      <Results page={page} query={query} />
    </>
  );
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Video games on Wikipedia, by region and release date
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        26,000 games placed by their country of origin, sorted by when they came
        out. Open one to read its article, or ask a question and get an answer
        that cites the passages it used.
      </p>
      <div className="mt-6">
        <Suspense
          fallback={<p className="text-sm text-muted">Loading games…</p>}
        >
          <Browse searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
