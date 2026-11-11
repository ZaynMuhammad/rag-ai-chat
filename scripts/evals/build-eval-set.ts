import { BunRuntime, BunServices } from "@effect/platform-bun";
import { createHash } from "node:crypto";
import { Effect, FileSystem, Layer, Schema, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import {
  asyncBufferFromFile,
  parquetMetadataAsync,
  parquetReadObjects,
} from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { CorpusStore } from "../../src/corpus/CorpusStore";
import { datasetRevision as wikipediaRevision } from "../../src/corpus/StructuredWikipedia";
import {
  HotpotRow,
  hotpotQuestion,
  KiltRow,
  kiltNqQuestion,
  titleKey,
} from "../../src/evals/BenchmarkSources";
import {
  type EvalQuestion,
  EvalQuestionLine,
} from "../../src/evals/EvalQuestion";
import { isResolved, resolveGold } from "../../src/evals/Evidence";
import { CorpusDatabase, dataDirectory } from "../corpus/CorpusDatabase";

const questionsPerSource = 75;
const downloadDirectory = `${dataDirectory}evals`;
const evalDirectory = new URL("../../evals/games/", import.meta.url).pathname;

const hotpotRevision = "1908d6afbbead072334abe2965f91bd2709910ab";
const kiltRevision = "0f7881c6bf693742af91a31b4d8f827db2f41233";

const sources = {
  hotpotqa: {
    dataset: "hotpotqa/hotpot_qa",
    revision: hotpotRevision,
    license: "CC BY-SA 4.0",
    files: [
      "distractor/train-00000-of-00002.parquet",
      "distractor/train-00001-of-00002.parquet",
      "distractor/validation-00000-of-00001.parquet",
    ],
  },
  kilt_nq: {
    dataset: "facebook/kilt_tasks",
    revision: kiltRevision,
    license: "KILT code MIT; Natural Questions data CC BY-SA 3.0",
    files: [
      "nq/train-00000-of-00001.parquet",
      "nq/validation-00000-of-00001.parquet",
    ],
  },
} as const;

const localName = (dataset: string, file: string) =>
  `${dataset.replace("/", "__")}__${file.replaceAll("/", "__")}`;

const download = Effect.fn("download")(function* (
  dataset: string,
  revision: string,
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const target = `${downloadDirectory}/${localName(dataset, file)}`;
  if (yield* fs.exists(target)) return target;
  yield* fs.makeDirectory(downloadDirectory, { recursive: true });
  yield* client
    .get(
      `https://huggingface.co/datasets/${dataset}/resolve/${revision}/${file}`,
    )
    .pipe(HttpClientResponse.stream, Stream.run(fs.sink(`${target}.partial`)));
  yield* fs.rename(`${target}.partial`, target);
  return target;
});

const openParquet = (file: string) =>
  Effect.gen(function* () {
    const buffer = yield* Effect.tryPromise(() => asyncBufferFromFile(file));
    const metadata = yield* Effect.tryPromise(() =>
      parquetMetadataAsync(buffer),
    );
    const read = (
      columns: ReadonlyArray<string>,
      rowStart?: number,
      rowEnd?: number,
    ) =>
      Effect.tryPromise(() =>
        parquetReadObjects({
          file: buffer,
          metadata,
          compressors,
          columns: [...columns],
          ...(rowStart === undefined ? {} : { rowStart }),
          ...(rowEnd === undefined ? {} : { rowEnd }),
        }),
      );
    return { read };
  });

const readRows = <S extends Schema.Top>(
  file: string,
  schema: S,
  columns: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const parquet = yield* openParquet(file);
    const rows = yield* parquet.read(columns);
    return yield* Effect.forEach(rows, (row) =>
      Schema.decodeUnknownEffect(schema)(row),
    );
  });

const SupportingTitles = Schema.Struct({
  supporting_facts: Schema.Struct({ title: Schema.Array(Schema.String) }),
});

const readHotpotRows = (
  file: string,
  keep: (titles: ReadonlyArray<string>) => boolean,
) =>
  Effect.gen(function* () {
    const parquet = yield* openParquet(file);
    const facts = yield* parquet.read(["supporting_facts"]);
    const decodeFacts = Schema.decodeUnknownEffect(SupportingTitles);
    const matching: Array<number> = [];
    for (const [index, row] of facts.entries()) {
      if (keep((yield* decodeFacts(row)).supporting_facts.title))
        matching.push(index);
    }
    return yield* Effect.forEach(matching, (index) =>
      parquet
        .read(
          [
            "id",
            "question",
            "answer",
            "type",
            "level",
            "supporting_facts",
            "context",
          ],
          index,
          index + 1,
        )
        .pipe(
          Effect.flatMap(([row]) => Schema.decodeUnknownEffect(HotpotRow)(row)),
        ),
    );
  });

const stableOrder = (question: EvalQuestion) =>
  createHash("sha256").update(question.id).digest("hex");

const sample = (questions: ReadonlyArray<EvalQuestion>, count: number) =>
  [...questions]
    .sort((a, b) => stableOrder(a).localeCompare(stableOrder(b)))
    .slice(0, count);

const program = Effect.gen(function* () {
  const store = yield* CorpusStore;
  const fs = yield* FileSystem.FileSystem;
  const stats = yield* store.stats;
  const qidByTitle = new Map(
    (yield* store.gameTitles).map((game) => [titleKey(game.title), game.qid]),
  );
  const inCorpus = (titles: ReadonlyArray<string>) =>
    titles.every((title) => qidByTitle.has(titleKey(title)));

  const hotpotFiles = yield* Effect.forEach(sources.hotpotqa.files, (file) =>
    download(sources.hotpotqa.dataset, sources.hotpotqa.revision, file),
  );
  const hotpotCandidates = (yield* Effect.forEach(hotpotFiles, (file) =>
    readHotpotRows(file, inCorpus),
  ))
    .flat()
    .flatMap((row) => hotpotQuestion(row, qidByTitle) ?? []);

  const kiltFiles = yield* Effect.forEach(sources.kilt_nq.files, (file) =>
    download(sources.kilt_nq.dataset, sources.kilt_nq.revision, file),
  );
  const kiltCandidates = (yield* Effect.forEach(kiltFiles, (file) =>
    readRows(file, KiltRow, ["id", "input", "output"]),
  ))
    .flat()
    .flatMap((row) => kiltNqQuestion(row, qidByTitle) ?? []);

  const candidates = [...hotpotCandidates, ...kiltCandidates];
  const goldQids = [
    ...new Set(
      candidates.flatMap((question) =>
        question.gold.map((article) => article.qid),
      ),
    ),
  ];
  const passages = yield* store.passagesOf(goldQids);
  const passagesByGame = Map.groupBy(passages, (passage) => passage.gameQid);
  const resolved = candidates.filter((question) =>
    isResolved(resolveGold(question, passagesByGame)),
  );

  const bySource = (source: EvalQuestion["source"]) => ({
    candidates: candidates.filter((question) => question.source === source)
      .length,
    resolved: resolved.filter((question) => question.source === source).length,
  });
  const benchmark = [
    ...sample(
      resolved.filter((question) => question.source === "hotpotqa"),
      questionsPerSource,
    ),
    ...sample(
      resolved.filter((question) => question.source === "kilt_nq"),
      questionsPerSource,
    ),
  ];

  const encodeLine = Schema.encodeEffect(EvalQuestionLine);
  const lines = yield* Effect.forEach(benchmark, (question) =>
    encodeLine(question),
  );
  yield* fs.makeDirectory(evalDirectory, { recursive: true });
  yield* fs.writeFileString(
    `${evalDirectory}benchmark.jsonl`,
    `${lines.join("\n")}\n`,
  );
  yield* fs.writeFileString(
    `${evalDirectory}manifest.json`,
    `${JSON.stringify(
      {
        corpus: {
          dataset: "wikimedia/structured-wikipedia",
          revision: wikipediaRevision,
          games: stats.games,
          gamesWithText: stats.gamesWithText,
          passages: stats.passages,
        },
        sources: {
          hotpotqa: { ...sources.hotpotqa, ...bySource("hotpotqa") },
          kilt_nq: { ...sources.kilt_nq, ...bySource("kilt_nq") },
        },
        questionsPerSource,
        benchmarkQuestions: benchmark.length,
      },
      null,
      2,
    )}\n`,
  );
  yield* Effect.logInfo(
    `HotpotQA ${JSON.stringify(bySource("hotpotqa"))}, KILT NQ ${JSON.stringify(bySource("kilt_nq"))}; ` +
      `wrote ${benchmark.length} questions to ${evalDirectory}benchmark.jsonl`,
  );
});

const services = Layer.mergeAll(CorpusDatabase, FetchHttpClient.layer).pipe(
  Layer.provideMerge(BunServices.layer),
);

BunRuntime.runMain(program.pipe(Effect.provide(services)));
