import { Effect } from "effect";
import { Suspense } from "react";
import { ScopedChat } from "@/components/ScopedChat";
import { areaValue, scopeFromParams, type SearchParams } from "@/app/params";
import { GameCatalog } from "@/server/games/GameCatalog";
import { runAtRequestTime } from "@/app/run";

async function Chat({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const scope = scopeFromParams(await searchParams);
  const subRegions = await runAtRequestTime(
    Effect.flatMap(GameCatalog, (catalog) => catalog.subRegions),
  );
  return (
    <ScopedChat
      initialArea={areaValue(scope)}
      initialFrom={scope.from === undefined ? "" : String(scope.from)}
      initialTo={scope.to === undefined ? "" : String(scope.to)}
      subRegions={subRegions}
    />
  );
}

export default function ChatPage({ searchParams }: PageProps<"/chat">) {
  return (
    <main className="mx-auto flex h-[calc(100dvh-7.5rem)] w-full max-w-3xl flex-col px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight">
        Ask the game articles
      </h1>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        Narrow by region and release years to keep answers on the games you
        mean.
      </p>
      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <Chat searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
