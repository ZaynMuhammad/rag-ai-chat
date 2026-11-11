import { citationPattern } from "@/lib/citations";
import { contentTerms } from "@/server/search/Retriever";
import type { EvidencePassage } from "./Evidence";

export interface AnswerSentence {
  readonly text: string;
  readonly citations: ReadonlyArray<number>;
}

const sentenceBoundary = /(?<=[.!?]|\])\s+(?=[\p{Lu}\p{N}"“(])/u;

export const answerSentences = (
  answer: string,
): ReadonlyArray<AnswerSentence> =>
  answer
    .split(sentenceBoundary)
    .map((sentence) => ({
      text: sentence.replaceAll(citationPattern, " ").replaceAll(/\s+/g, " "),
      citations: [...sentence.matchAll(citationPattern)].map((match) =>
        Number(match[1]),
      ),
    }))
    .map(({ text, citations }) => ({ text: text.trim(), citations }))
    .filter(({ text }) => text !== "");

export const stripCitations = (answer: string) =>
  answerSentences(answer)
    .map((sentence) => sentence.text)
    .join(" ");

const abstentionPattern =
  /\b(?:do|does|did)(?: not|n['’]t) (?:cover|mention|say|state|contain|include|specify|answer)\b|\bnot (?:covered|mentioned|stated)\b|\bno information\b/i;

export const isAbstention = (answer: string) =>
  abstentionPattern.test(answer.replaceAll(/\s+/g, " "));

const articles = new Set(["a", "an", "the"]);

export const answerTokens = (text: string) =>
  text
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((token) => token !== "" && !articles.has(token));

const countTokens = (tokens: ReadonlyArray<string>) => {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
};

export const tokenF1 = (prediction: string, gold: string) => {
  const predicted = answerTokens(prediction);
  const expected = answerTokens(gold);
  if (predicted.length === 0 || expected.length === 0) return 0;
  const goldCounts = countTokens(expected);
  let overlap = 0;
  for (const [token, count] of countTokens(predicted)) {
    overlap += Math.min(count, goldCounts.get(token) ?? 0);
  }
  if (overlap === 0) return 0;
  const precision = overlap / predicted.length;
  const recall = overlap / expected.length;
  return (2 * precision * recall) / (precision + recall);
};

export const containsAnswer = (prediction: string, gold: string) => {
  const needle = answerTokens(gold).join(" ");
  return (
    needle !== "" &&
    ` ${answerTokens(prediction).join(" ")} `.includes(` ${needle} `)
  );
};

export interface ScoredAnswer {
  readonly abstained: boolean;
  readonly failed: boolean;
  readonly goldPassageSent: boolean | null;
  readonly answerContainment: number | null;
  readonly answerF1: number | null;
  readonly citationValidity: number | null;
  readonly citationPrecision: number | null;
  readonly citationRecall: number | null;
  readonly uncitedSentenceRate: number | null;
  readonly faithfulness: number | null;
}

export interface AnswerUnderTest {
  readonly answerable: boolean;
  readonly answers: ReadonlyArray<string>;
  readonly goldGameQids: ReadonlySet<string>;
  readonly goldPassageIds: ReadonlySet<string>;
  readonly passages: ReadonlyArray<EvidencePassage>;
  readonly answer: string;
  readonly failed: boolean;
}

const share = (part: number, whole: number) =>
  whole === 0 ? null : part / whole;

const sentenceSupport = (
  sentence: AnswerSentence,
  passages: ReadonlyArray<EvidencePassage>,
) => {
  const terms = contentTerms(sentence.text);
  if (terms.length === 0) return null;
  const cited = new Set(
    sentence.citations.flatMap((number) => {
      const passage = passages[number - 1];
      return passage === undefined ? [] : contentTerms(passage.text);
    }),
  );
  return terms.filter((term) => cited.has(term)).length / terms.length;
};

const meanOrNull = (values: ReadonlyArray<number | null>) => {
  const present = values.filter((value) => value !== null);
  return present.length === 0
    ? null
    : present.reduce((total, value) => total + value, 0) / present.length;
};

export const scoreAnswer = (run: AnswerUnderTest): ScoredAnswer => {
  const { answerable, passages, goldPassageIds, goldGameQids } = run;
  const abstained = !run.failed && isAbstention(run.answer);
  const sentences = answerSentences(run.answer);
  const markers = sentences.flatMap((sentence) => sentence.citations);
  const isValid = (number: number) =>
    Number.isInteger(number) && number >= 1 && number <= passages.length;
  const cited = [...new Set(markers.filter(isValid))].flatMap((number) => {
    const passage = passages[number - 1];
    return passage === undefined ? [] : [passage];
  });
  const prose = stripCitations(run.answer);
  const claims = abstained ? [] : sentences;
  const hasGoldPassages = answerable && goldPassageIds.size > 0;

  return {
    abstained,
    failed: run.failed,
    goldPassageSent: hasGoldPassages
      ? passages.some((passage) => goldPassageIds.has(passage.id))
      : null,
    answerContainment: answerable
      ? Number(run.answers.some((gold) => containsAnswer(prose, gold)))
      : null,
    answerF1: answerable
      ? Math.max(0, ...run.answers.map((gold) => tokenF1(prose, gold)))
      : null,
    citationValidity: share(markers.filter(isValid).length, markers.length),
    citationPrecision:
      hasGoldPassages && cited.length > 0
        ? cited.filter((passage) => goldPassageIds.has(passage.id)).length /
          cited.length
        : null,
    citationRecall:
      answerable && goldGameQids.size > 0
        ? [...goldGameQids].filter((qid) =>
            cited.some((passage) => passage.gameQid === qid),
          ).length / goldGameQids.size
        : null,
    uncitedSentenceRate: share(
      claims.filter((sentence) => !sentence.citations.some(isValid)).length,
      claims.length,
    ),
    faithfulness: meanOrNull(
      claims.map((sentence) => sentenceSupport(sentence, passages)),
    ),
  };
};

export interface AnswerSummary {
  readonly questions: number;
  readonly answerable: number;
  readonly unanswerable: number;
  readonly failureRate: number | null;
  readonly goldPassageSent: number | null;
  readonly answerContainment: number | null;
  readonly answerF1: number | null;
  readonly citationValidity: number | null;
  readonly citationPrecision: number | null;
  readonly citationRecall: number | null;
  readonly uncitedSentenceRate: number | null;
  readonly faithfulness: number | null;
  readonly correctAbstention: number | null;
  readonly falseAbstention: number | null;
}

export const summarizeAnswers = (
  scored: ReadonlyArray<{ readonly answerable: boolean } & ScoredAnswer>,
): AnswerSummary => {
  const answerable = scored.filter((entry) => entry.answerable);
  const unanswerable = scored.filter((entry) => !entry.answerable);
  const mean = (
    entries: ReadonlyArray<ScoredAnswer>,
    pick: (entry: ScoredAnswer) => number | boolean | null,
  ) =>
    meanOrNull(
      entries.map((entry) => {
        const value = pick(entry);
        return typeof value === "boolean" ? Number(value) : value;
      }),
    );
  return {
    questions: scored.length,
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    failureRate: mean(scored, (entry) => entry.failed),
    goldPassageSent: mean(answerable, (entry) => entry.goldPassageSent),
    answerContainment: mean(answerable, (entry) => entry.answerContainment),
    answerF1: mean(answerable, (entry) => entry.answerF1),
    citationValidity: mean(scored, (entry) => entry.citationValidity),
    citationPrecision: mean(answerable, (entry) => entry.citationPrecision),
    citationRecall: mean(answerable, (entry) => entry.citationRecall),
    uncitedSentenceRate: mean(scored, (entry) => entry.uncitedSentenceRate),
    faithfulness: mean(scored, (entry) => entry.faithfulness),
    correctAbstention: mean(unanswerable, (entry) => entry.abstained),
    falseAbstention: mean(answerable, (entry) => entry.abstained),
  };
};
