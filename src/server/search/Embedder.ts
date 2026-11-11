import { Config, Context, Effect, Layer, Predicate, Schema } from "effect";
import { words } from "@/corpus/Terms";
import { normalize } from "./Vectors";

export const embeddingModel = "Snowflake/snowflake-arctic-embed-xs";
export const queryPrefix =
  "Represent this sentence for searching relevant passages: ";
export const passageTokenLimit = 256;
const queryTokenLimit = 128;

export const passageInput = (passage: {
  readonly heading: string;
  readonly text: string;
}) => `${passage.heading}\n${passage.text}`;

export class EmbedderError extends Schema.TaggedError<EmbedderError>()(
  "EmbedderError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

export interface OnnxEmbedderOptions {
  readonly modelDirectory: string;
  readonly allowDownload: boolean;
}

export class Embedder extends Context.Service<
  Embedder,
  {
    readonly model: string;
    readonly dimensions: number;
    embedQuery(query: string): Effect.Effect<Float32Array>;
    embedPassages(
      passages: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyArray<Float32Array>>;
  }
>()("rag-ai-chat/search/Embedder") {
  static readonly onnx = (options: OnnxEmbedderOptions) =>
    Layer.effect(
      Embedder,
      Effect.gen(function* () {
        const { AutoModel, AutoTokenizer, Tensor, env } = yield* Effect.promise(
          () => import("@huggingface/transformers"),
        );
        env.cacheDir = options.modelDirectory;
        env.allowRemoteModels = options.allowDownload;

        const [tokenizer, model] = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              Promise.all([
                AutoTokenizer.from_pretrained(embeddingModel),
                AutoModel.from_pretrained(embeddingModel, { dtype: "q8" }),
              ]),
            catch: (cause) =>
              new EmbedderError({
                message: `Could not load ${embeddingModel} from ${options.modelDirectory}. Run bun run corpus:embed to download it.`,
                cause,
              }),
          }),
          ([, loaded]) => Effect.promise(() => loaded.dispose()),
        );

        const clsVectors = (output: unknown) => {
          const hidden = Predicate.hasProperty(output, "last_hidden_state")
            ? output.last_hidden_state
            : undefined;
          if (
            !(hidden instanceof Tensor) ||
            !(hidden.data instanceof Float32Array)
          ) {
            throw new Error("Embedding model returned no float hidden state");
          }
          const [batch = 0, tokens = 0, dimensions = 0] = hidden.dims;
          const data = hidden.data;
          return Array.from({ length: batch }, (_, row) =>
            normalize(
              data.slice(
                row * tokens * dimensions,
                row * tokens * dimensions + dimensions,
              ),
            ),
          );
        };

        const embed = (texts: ReadonlyArray<string>, maxLength: number) =>
          Effect.tryPromise({
            try: async () =>
              clsVectors(
                await model(
                  tokenizer([...texts], {
                    padding: true,
                    truncation: true,
                    max_length: maxLength,
                  }),
                ),
              ),
            catch: (cause) =>
              new EmbedderError({ message: "Embedding failed", cause }),
          }).pipe(Effect.orDie);

        const [probe] = yield* embed(["probe"], queryTokenLimit);

        return Embedder.of({
          model: embeddingModel,
          dimensions: probe?.length ?? 0,
          embedQuery: Effect.fn("Embedder.embedQuery")(function* (query) {
            const [vector] = yield* embed(
              [`${queryPrefix}${query}`],
              queryTokenLimit,
            );
            return vector ?? new Float32Array();
          }),
          embedPassages: Effect.fn("Embedder.embedPassages")(
            function* (passages) {
              if (passages.length === 0) return [];
              return yield* embed(passages, passageTokenLimit);
            },
          ),
        });
      }),
    );

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const modelDirectory = yield* Config.String(
        "EMBEDDING_MODEL_DIRECTORY",
      ).pipe(Config.withDefault("data/models"));
      return Embedder.onnx({ modelDirectory, allowDownload: false });
    }),
  );

  static readonly hashed = (dimensions: number) =>
    Layer.succeed(
      Embedder,
      Embedder.of({
        model: `hashed-${dimensions}`,
        dimensions,
        embedQuery: (query) => Effect.succeed(hashedVector(query, dimensions)),
        embedPassages: (passages) =>
          Effect.succeed(
            passages.map((passage) => hashedVector(passage, dimensions)),
          ),
      }),
    );
}

const fnv1a = (word: string) => {
  let hash = 0x811c9dc5;
  for (const char of word) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
  }
  return hash >>> 0;
};

export const hashedVector = (text: string, dimensions: number) => {
  const vector = new Float32Array(dimensions);
  for (const word of words(text)) {
    const hash = fnv1a(word);
    const bucket = hash % dimensions;
    vector[bucket] = (vector[bucket] ?? 0) + (hash & 1 ? 1 : -1);
  }
  return normalize(vector);
};
