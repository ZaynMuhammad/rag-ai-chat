import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Predicate,
  Schedule,
  Schema,
  Stream,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import {
  asyncBufferFromFile,
  parquetMetadataAsync,
  parquetReadObjects,
} from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { ArticleSections, type ArticlePart } from "./ArticleBlocks";

export const datasetRevision = "417c267bb457fa645c22eb3b5c77764963194c70";
const datasetApi = `https://huggingface.co/api/datasets/wikimedia/structured-wikipedia/tree/${datasetRevision}/enwiki/data`;
const datasetFiles = `https://huggingface.co/datasets/wikimedia/structured-wikipedia/resolve/${datasetRevision}`;
const articleColumns = [
  "main_entity",
  "name",
  "identifier",
  "url",
  "description",
  "version",
  "sections",
];

const mainEntityQid = (row: Record<string, unknown>) => {
  const entity = row["main_entity"];
  return Predicate.isObject(entity) && "identifier" in entity
    ? entity.identifier
    : undefined;
};

export class Shard extends Schema.Class<Shard>("rag-ai-chat/corpus/Shard")({
  path: Schema.String,
  size: Schema.Number,
}) {
  get name() {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
}

const DatasetTree = Schema.Array(
  Schema.Struct({
    type: Schema.String,
    path: Schema.String,
    size: Schema.Number,
  }),
);

const WholeNumber = Schema.Union([Schema.Number, Schema.BigInt]);

const StructuredRow = Schema.Struct({
  main_entity: Schema.NullOr(Schema.Struct({ identifier: Schema.String })),
  name: Schema.String,
  identifier: WholeNumber,
  url: Schema.String,
  description: Schema.NullOr(Schema.String),
  version: Schema.Struct({ identifier: WholeNumber }),
  sections: Schema.NullOr(ArticleSections),
});

export interface StructuredArticle {
  readonly qid: string;
  readonly title: string;
  readonly pageId: number;
  readonly revisionId: number;
  readonly url: string;
  readonly description: string | null;
  readonly sections: ReadonlyArray<ArticlePart>;
}

const shardIndex = (shard: Shard) =>
  Number(/_(\d+)\.parquet$/.exec(shard.path)?.[1] ?? Number.NaN);

export class IncompleteDownload extends Schema.TaggedError<IncompleteDownload>()(
  "IncompleteDownload",
  { expected: Schema.Number, received: Schema.Number },
) {}

export class StructuredWikipediaError extends Schema.TaggedError<StructuredWikipediaError>()(
  "StructuredWikipediaError",
  { shard: Schema.String, cause: Schema.Defect() },
) {}

export class StructuredWikipedia extends Context.Service<
  StructuredWikipedia,
  {
    readonly shards: Effect.Effect<
      ReadonlyArray<Shard>,
      StructuredWikipediaError
    >;
    download(
      shard: Shard,
      directory: string,
    ): Effect.Effect<string, StructuredWikipediaError>;
    articles(
      file: string,
      qids: ReadonlySet<string>,
    ): Effect.Effect<
      ReadonlyArray<StructuredArticle>,
      StructuredWikipediaError
    >;
  }
>()("rag-ai-chat/corpus/StructuredWikipedia") {
  static readonly layer = Layer.effect(
    StructuredWikipedia,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
      );
      const decodeRow = Schema.decodeUnknownEffect(StructuredRow);

      const shards = client.get(datasetApi).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(DatasetTree)),
        Effect.map((entries) =>
          entries
            .filter(
              (entry) =>
                entry.type === "file" && entry.path.endsWith(".parquet"),
            )
            .map((entry) => new Shard({ path: entry.path, size: entry.size }))
            .sort((a, b) => shardIndex(a) - shardIndex(b)),
        ),
        Effect.mapError(
          (cause) => new StructuredWikipediaError({ shard: "index", cause }),
        ),
        Effect.withSpan("StructuredWikipedia.shards"),
      );

      const download = Effect.fn("StructuredWikipedia.download")(
        function* (shard: Shard, directory: string) {
          const target = path.join(directory, shard.name);
          const partial = `${target}.partial`;
          if (
            (yield* fs.exists(target)) &&
            (yield* fs.stat(target)).size === BigInt(shard.size)
          )
            return target;
          yield* fs.makeDirectory(directory, { recursive: true });
          yield* HttpClientRequest.get(`${datasetFiles}/${shard.path}`).pipe(
            client.execute,
            HttpClientResponse.stream,
            Stream.run(fs.sink(partial)),
          );
          const { size } = yield* fs.stat(partial);
          if (size !== BigInt(shard.size)) {
            return yield* new IncompleteDownload({
              expected: shard.size,
              received: Number(size),
            });
          }
          yield* fs.rename(partial, target);
          return target;
        },
        Effect.retry({ schedule: Schedule.exponential("5 seconds"), times: 3 }),
        (effect, shard) =>
          Effect.mapError(
            effect,
            (cause) =>
              new StructuredWikipediaError({ shard: shard.name, cause }),
          ),
      );

      const articles = Effect.fn("StructuredWikipedia.articles")(
        function* (file: string, qids: ReadonlySet<string>) {
          const buffer = yield* Effect.tryPromise(() =>
            asyncBufferFromFile(file),
          );
          const metadata = yield* Effect.tryPromise(() =>
            parquetMetadataAsync(buffer),
          );
          const found: Array<StructuredArticle> = [];
          let rowStart = 0;
          for (const rowGroup of metadata.row_groups) {
            const rowEnd = rowStart + Number(rowGroup.num_rows);
            const rows = yield* Effect.tryPromise(() =>
              parquetReadObjects({
                file: buffer,
                metadata,
                compressors,
                columns: articleColumns,
                rowStart,
                rowEnd,
              }),
            );
            for (const raw of rows) {
              const qid = mainEntityQid(raw);
              if (!Predicate.isString(qid) || !qids.has(qid)) continue;
              const row = yield* decodeRow(raw);
              found.push({
                qid,
                title: row.name,
                pageId: Number(row.identifier),
                revisionId: Number(row.version.identifier),
                url: row.url,
                description: row.description,
                sections: row.sections ?? [],
              });
            }
            rowStart = rowEnd;
          }
          return found;
        },
        (effect, file) =>
          Effect.mapError(
            effect,
            (cause) => new StructuredWikipediaError({ shard: file, cause }),
          ),
      );

      return StructuredWikipedia.of({ shards, download, articles });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
