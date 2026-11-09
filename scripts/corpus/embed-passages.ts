import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Array as Arr, Clock, Config, Effect, Layer, Option } from "effect";
import {
  CorpusStore,
  type PassageEmbedding,
} from "../../src/corpus/CorpusStore";
import { Embedder, passageInput } from "../../src/server/search/Embedder";
import { codesToBlob, quantize } from "../../src/server/search/Vectors";
import { CorpusDatabase, dataDirectory } from "./CorpusDatabase";

const passagesPerRead = 512;
const passagesPerBatch = 32;

const embedRead = Effect.fn("embedRead")(function* (
  passages: ReadonlyArray<{ id: string; heading: string; text: string }>,
) {
  const embedder = yield* Embedder;
  const byLength = passages.toSorted(
    (a, b) => passageInput(a).length - passageInput(b).length,
  );
  const embeddings: Array<PassageEmbedding> = [];
  for (const batch of Arr.chunksOf(byLength, passagesPerBatch)) {
    const vectors = yield* embedder.embedPassages(batch.map(passageInput));
    for (const [index, passage] of batch.entries()) {
      const vector = vectors[index];
      if (vector === undefined) continue;
      const { codes, scale } = quantize(vector);
      embeddings.push({
        passageId: passage.id,
        vector: codesToBlob(codes),
        scale,
      });
    }
  }
  return embeddings;
});

const program = Effect.gen(function* () {
  const store = yield* CorpusStore;
  const embedder = yield* Embedder;
  const limit = Option.getOrElse(
    yield* Config.option(Config.Int("EMBED_LIMIT")),
    () => Number.POSITIVE_INFINITY,
  );
  const before = yield* store.embeddingProgress;
  yield* Effect.logInfo(
    `${embedder.model}: ${before.embedded} of ${before.passages} passages already embedded`,
  );

  const started = yield* Clock.currentTimeMillis;
  let embedded = 0;
  let after = 0;
  while (embedded < limit) {
    const passages = yield* store.passagesToEmbedAfter(
      after,
      Math.min(passagesPerRead, limit - embedded),
    );
    const last = passages.at(-1);
    if (last === undefined) break;
    yield* store.saveEmbeddings(yield* embedRead(passages));
    embedded += passages.length;
    after = last.rowid;

    const seconds = ((yield* Clock.currentTimeMillis) - started) / 1000;
    const perSecond = embedded / seconds;
    const remaining = before.passages - before.embedded - embedded;
    yield* Effect.logInfo(
      `${embedded} embedded, ${perSecond.toFixed(1)} passages/s, ${remaining} left, about ${(remaining / perSecond / 3600).toFixed(2)} h to go`,
    );
  }

  const finished = yield* store.embeddingProgress;
  yield* Effect.logInfo(
    `${finished.embedded} of ${finished.passages} passages embedded; vectors take ${((finished.embedded * (embedder.dimensions + 8)) / 1e6).toFixed(1)} MB`,
  );
});

BunRuntime.runMain(
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        CorpusDatabase,
        Embedder.onnx({
          modelDirectory: `${dataDirectory}models`,
          allowDownload: true,
        }),
      ).pipe(Layer.provideMerge(BunServices.layer)),
    ),
  ),
);
