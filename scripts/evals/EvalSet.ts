import { Effect, FileSystem, Schema } from "effect";
import { EvalQuestionLine } from "../../src/evals/EvalQuestion";

export const evalDirectory = new URL("../../evals/games/", import.meta.url)
  .pathname;

const loadQuestions = Effect.fn("loadQuestions")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const lines = (yield* fs.readFileString(file))
    .split("\n")
    .filter((line) => line.trim() !== "");
  return yield* Effect.forEach(lines, (line) =>
    Schema.decodeUnknownEffect(EvalQuestionLine)(line),
  );
});

export const loadEvalSets = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const files = (yield* fs.readDirectory(evalDirectory))
    .filter((file) => file.endsWith(".jsonl"))
    .sort();
  return yield* Effect.forEach(files, (file) =>
    Effect.map(loadQuestions(`${evalDirectory}${file}`), (questions) => ({
      file,
      questions,
    })),
  );
});
