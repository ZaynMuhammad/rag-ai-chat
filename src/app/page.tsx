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
    <Suspense
      fallback={
        <p className="p-6 text-sm text-muted-foreground">Loading the globe…</p>
      }
    >
      <AtlasWithPins />
    </Suspense>
  );
}
