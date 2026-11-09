import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Layer } from "effect";
import { CorpusStore } from "../../src/corpus/CorpusStore";
import { groupByRegion } from "../../src/corpus/RegionIndex";
import { datasetRevision } from "../../src/corpus/StructuredWikipedia";
import { CorpusDatabase, corpusDirectory } from "./CorpusDatabase";

const outputPath = `${corpusDirectory}/regions.json`;

const program = Effect.gen(function* () {
  const store = yield* CorpusStore;
  const fs = yield* FileSystem.FileSystem;
  const regions = groupByRegion(yield* store.placedGames);
  yield* fs.writeFileString(
    outputPath,
    JSON.stringify({
      source: {
        games:
          "Wikidata instances of video game (Q7889) with an English Wikipedia article",
        origin:
          "country of origin (P495), else the developer's country (P178/P17)",
        regions: "UN M49 standard country or area codes",
        text: `wikimedia/structured-wikipedia@${datasetRevision}`,
        license: "Wikipedia text CC BY-SA 4.0; Wikidata CC0",
      },
      regions,
    }),
  );
  for (const region of regions) {
    yield* Effect.logInfo(
      `${region.region}: ${region.gameCount} games — ` +
        region.subRegions
          .map((subRegion) => `${subRegion.subRegion} ${subRegion.gameCount}`)
          .join(", "),
    );
  }
  yield* Effect.logInfo(`Wrote ${outputPath}`);
});

BunRuntime.runMain(
  program.pipe(
    Effect.provide(Layer.provideMerge(CorpusDatabase, BunServices.layer)),
  ),
);
