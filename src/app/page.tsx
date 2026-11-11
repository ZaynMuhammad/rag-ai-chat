import { Effect } from "effect";
import { Suspense } from "react";
import { Atlas } from "@/components/atlas/Atlas";
import { GameCatalog } from "@/server/games/GameCatalog";
import { runAtRequestTime } from "@/app/run";

async function AtlasWithPins() {
  const pins = await runAtRequestTime(
    Effect.flatMap(GameCatalog, (catalog) => catalog.pins),
  );
  return <Atlas pins={pins} />;
}

export default function Home() {
  return (
    <main className="mx-auto flex h-[calc(100dvh-6.5rem)] w-full max-w-6xl flex-col px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          Video games on Wikipedia, by where they were made
        </h1>
        <p className="text-xs text-muted-foreground">
          Drag to spin · scroll to zoom · click a pin
        </p>
      </div>
      <div className="relative mt-2 min-h-0 flex-1">
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">Loading the globe…</p>
          }
        >
          <AtlasWithPins />
        </Suspense>
      </div>
    </main>
  );
}
