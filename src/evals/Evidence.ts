import type { EvalQuestion } from "./EvalQuestion";

export interface EvidencePassage {
  readonly id: string;
  readonly gameQid: string;
  readonly text: string;
}

export const sentenceRecallThreshold = 0.6;
const minimumSentenceTerms = 6;

export const normalizeText = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const termsOf = (text: string) =>
  normalizeText(text)
    .split(" ")
    .filter((term) => term !== "");

export const containsPhrase = (passage: string, evidence: string) => {
  const needle = normalizeText(evidence);
  return needle !== "" && ` ${normalizeText(passage)} `.includes(` ${needle} `);
};

export const termRecall = (evidence: string, passage: string) => {
  const evidenceTerms = termsOf(evidence);
  if (evidenceTerms.length === 0) return 0;
  const passageTerms = new Set(termsOf(passage));
  return (
    evidenceTerms.filter((term) => passageTerms.has(term)).length /
    evidenceTerms.length
  );
};

const isSentence = (evidence: string) =>
  termsOf(evidence).length >= minimumSentenceTerms;

export const evidencePassages = <P extends EvidencePassage>(
  articlePassages: ReadonlyArray<P>,
  evidence: string,
): ReadonlyArray<P> => {
  const exact = articlePassages.filter((passage) =>
    containsPhrase(passage.text, evidence),
  );
  if (exact.length > 0 || !isSentence(evidence)) return exact;
  const scored = articlePassages.map((passage) => ({
    passage,
    recall: termRecall(evidence, passage.text),
  }));
  const best = scored.reduce<(typeof scored)[number] | undefined>(
    (top, candidate) =>
      top === undefined || candidate.recall > top.recall ? candidate : top,
    undefined,
  );
  return best !== undefined && best.recall >= sentenceRecallThreshold
    ? [best.passage]
    : [];
};

export interface GoldResolution {
  readonly goldPassageIds: ReadonlySet<string>;
  readonly missingArticles: ReadonlyArray<string>;
  readonly articlesWithoutEvidence: ReadonlyArray<string>;
}

export const resolveGold = (
  question: EvalQuestion,
  passagesByGame: ReadonlyMap<string, ReadonlyArray<EvidencePassage>>,
): GoldResolution => {
  const goldPassageIds = new Set<string>();
  const missingArticles: Array<string> = [];
  const articlesWithoutEvidence: Array<string> = [];
  for (const article of question.gold) {
    const passages = passagesByGame.get(article.qid) ?? [];
    if (passages.length === 0) {
      missingArticles.push(article.qid);
      continue;
    }
    const supporting = article.evidence.flatMap((evidence) =>
      evidencePassages(passages, evidence),
    );
    if (supporting.length === 0) articlesWithoutEvidence.push(article.qid);
    for (const passage of supporting) goldPassageIds.add(passage.id);
  }
  return { goldPassageIds, missingArticles, articlesWithoutEvidence };
};

export const isResolved = (resolution: GoldResolution) =>
  resolution.missingArticles.length === 0 &&
  resolution.articlesWithoutEvidence.length === 0;
