import { Schema } from "effect";
import { EvalQuestion, GoldArticle } from "./EvalQuestion";

const WholeNumber = Schema.Union([Schema.Number, Schema.BigInt]);

export const HotpotRow = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  answer: Schema.String,
  type: Schema.String,
  level: Schema.String,
  supporting_facts: Schema.Struct({
    title: Schema.Array(Schema.String),
    sent_id: Schema.Array(WholeNumber),
  }),
  context: Schema.Struct({
    title: Schema.Array(Schema.String),
    sentences: Schema.Array(Schema.Array(Schema.String)),
  }),
});
export type HotpotRow = typeof HotpotRow.Type;

export const KiltRow = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  output: Schema.Array(
    Schema.Struct({
      answer: Schema.String,
      provenance: Schema.Array(Schema.Struct({ title: Schema.String })),
    }),
  ),
});
export type KiltRow = typeof KiltRow.Type;

export type QidByTitle = ReadonlyMap<string, string>;

const maxAnswerWords = 10;
const askedRelativeToItsOwnTime =
  /\b(next|new|newest|latest|upcoming|current|currently|being released)\b/i;

export const titleKey = (title: string) => title.replaceAll("_", " ").trim();

const unique = (values: ReadonlyArray<string>) => [...new Set(values)];

const goldArticles = (
  titles: ReadonlyArray<string>,
  qidByTitle: QidByTitle,
  evidenceFor: (title: string) => ReadonlyArray<string>,
) => {
  const gold = titles.map((title) => {
    const qid = qidByTitle.get(titleKey(title));
    return qid === undefined
      ? undefined
      : new GoldArticle({ qid, title, evidence: evidenceFor(title) });
  });
  return gold.every((article) => article !== undefined) ? gold : undefined;
};

export const hotpotQuestion = (row: HotpotRow, qidByTitle: QidByTitle) => {
  const titles = unique(row.supporting_facts.title);
  const supportingSentences = (title: string) => {
    const sentences =
      row.context.sentences[row.context.title.indexOf(title)] ?? [];
    return row.supporting_facts.title
      .flatMap((factTitle, index) =>
        factTitle === title
          ? [sentences[Number(row.supporting_facts.sent_id[index])]]
          : [],
      )
      .filter((sentence) => sentence !== undefined)
      .map((sentence) => sentence.trim());
  };
  const gold = goldArticles(titles, qidByTitle, supportingSentences);
  if (
    gold === undefined ||
    gold.some((article) => article.evidence.length === 0)
  )
    return undefined;
  return new EvalQuestion({
    id: `hotpotqa:${row.id}`,
    source: "hotpotqa",
    question: row.question.trim(),
    answers: [row.answer],
    answerable: true,
    gold,
    tags: ["multi_hop", row.type, row.level],
  });
};

export const kiltNqQuestion = (row: KiltRow, qidByTitle: QidByTitle) => {
  const answers = unique(
    row.output
      .map((output) => output.answer.trim())
      .filter(
        (answer) =>
          answer !== "" && answer.split(/\s+/).length <= maxAnswerWords,
      ),
  );
  const titles = unique(
    row.output.flatMap((output) =>
      output.provenance.map((provenance) => provenance.title),
    ),
  );
  if (
    answers.length === 0 ||
    titles.length === 0 ||
    askedRelativeToItsOwnTime.test(row.input)
  )
    return undefined;
  const gold = goldArticles(titles, qidByTitle, () => answers);
  if (gold === undefined) return undefined;
  return new EvalQuestion({
    id: `kilt_nq:${row.id}`,
    source: "kilt_nq",
    question: row.input.trim(),
    answers,
    answerable: true,
    gold,
    tags: ["single_hop"],
  });
};
