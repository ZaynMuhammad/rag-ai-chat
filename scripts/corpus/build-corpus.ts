import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Layer, Stream } from "effect";
import { articleBlocks } from "../../src/corpus/ArticleBlocks";
import { buildCatalog } from "../../src/corpus/Catalog";
import { chunkArticle } from "../../src/corpus/Chunker";
import { earliestReleases } from "../../src/corpus/ReleaseDate";
import { CorpusStore } from "../../src/corpus/CorpusStore";
import {
  StructuredWikipedia,
  type Shard,
} from "../../src/corpus/StructuredWikipedia";
import { Wikidata } from "../../src/corpus/Wikidata";
import {
  CorpusDatabase,
  corpusDatabasePath,
  dataDirectory,
} from "./CorpusDatabase";

const shardDirectory = `${dataDirectory}shards`;
const downloadsAhead = 2;

const loadCatalog = Effect.gen(function* () {
  const wikidata = yield* Wikidata;
  const gameOrigins = yield* wikidata.videoGameOrigins;
  const places = yield* wikidata.places([
    ...new Set(gameOrigins.map((row) => row.originQid)),
  ]);
  const catalog = buildCatalog(gameOrigins, places);
  yield* Effect.logInfo(
    `Wikidata: ${catalog.games.length} placeable video games, ${catalog.unplacedGameQids.length} unplaced`,
  );
  if (catalog.unresolvedPlaceQids.length > 0) {
    yield* Effect.logWarning(
      `Places without a region: ${catalog.unresolvedPlaceQids.join(", ")}`,
    );
  }
  return catalog;
});

const ingestShard = Effect.fn("ingestShard")(function* (
  shard: Shard,
  file: string,
  qids: ReadonlySet<string>,
) {
  const wikipedia = yield* StructuredWikipedia;
  const store = yield* CorpusStore;
  const fs = yield* FileSystem.FileSystem;
  const articles = yield* wikipedia.articles(file, qids);
  const ingested = articles.map((article) => ({
    article,
    chunks: chunkArticle(article.title, articleBlocks(article.sections)),
  }));
  yield* store.saveShard(shard.name, ingested);
  yield* fs.remove(file);
  const passages = ingested.reduce(
    (total, { chunks }) => total + chunks.length,
    0,
  );
  yield* Effect.logInfo(
    `${shard.name}: ${articles.length} articles, ${passages} passages`,
  );
});

const program = Effect.gen(function* () {
  const store = yield* CorpusStore;
  const wikipedia = yield* StructuredWikipedia;

  const catalog = yield* loadCatalog;
  yield* store.saveCatalog(catalog.games);
  const qids = new Set(catalog.games.map((game) => game.qid));

  const releases = earliestReleases(
    yield* (yield* Wikidata).releaseDates([...qids]),
  );
  yield* store.saveReleases(releases);
  yield* Effect.logInfo(
    `Wikidata: ${releases.length}/${qids.size} games have a release date`,
  );

  const done = yield* store.ingestedShards;
  const pending = (yield* wikipedia.shards).filter(
    (shard) => !done.has(shard.name),
  );
  yield* Effect.logInfo(
    `${done.size} shards already ingested, ${pending.length} to go`,
  );

  yield* Stream.fromIterable(pending).pipe(
    Stream.mapEffect(
      (shard) =>
        Effect.map(wikipedia.download(shard, shardDirectory), (file) => ({
          shard,
          file,
        })),
      {
        concurrency: downloadsAhead,
      },
    ),
    Stream.mapEffect(({ shard, file }) => ingestShard(shard, file, qids)),
    Stream.runDrain,
  );

  yield* store.rebuildSearchIndex;
  const stats = yield* store.stats;
  yield* Effect.logInfo(
    `Corpus at ${corpusDatabasePath}: ${stats.gamesWithText}/${stats.games} games with text, ` +
      `${stats.passages} passages, ~${stats.tokens} tokens, ${stats.shards} shards`,
  );
});

const services = Layer.mergeAll(
  CorpusDatabase,
  Wikidata.layer,
  StructuredWikipedia.layer,
).pipe(Layer.provideMerge(BunServices.layer));

BunRuntime.runMain(program.pipe(Effect.provide(services)));
