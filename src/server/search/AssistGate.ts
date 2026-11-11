import type { AssistDecision } from "./SearchProtocol";

export interface RankedPassage {
  readonly gameQid: string;
  readonly score: number;
}

export interface AssistSignals {
  readonly topScore: number;
  readonly margin: number;
  readonly termCoverage: number;
  readonly agreement: number;
}

export const agreementDepth = 6;
export const strongScore = 40;
export const decisiveMargin = 0.25;
export const assistThreshold = 0.7;

export const assistSignals = (
  ranked: ReadonlyArray<RankedPassage>,
  matchedTerms: number,
  queryTerms: number,
): AssistSignals => {
  const [first] = ranked;
  if (first === undefined || queryTerms === 0)
    return { topScore: 0, margin: 0, termCoverage: 0, agreement: 0 };
  const runnerUp = ranked.find((passage) => passage.gameQid !== first.gameQid);
  const top = ranked.slice(0, agreementDepth);
  return {
    topScore: first.score,
    margin:
      first.score <= 0
        ? 0
        : runnerUp === undefined
          ? 1
          : (first.score - runnerUp.score) / first.score,
    termCoverage: matchedTerms / queryTerms,
    agreement:
      top.filter((passage) => passage.gameQid === first.gameQid).length /
      top.length,
  };
};

const unit = (value: number) => Math.min(1, Math.max(0, value));

export const assistConfidence = (signals: AssistSignals) =>
  (unit(signals.topScore / strongScore) +
    unit(signals.margin / decisiveMargin) +
    unit(signals.termCoverage) +
    unit(signals.agreement)) /
  4;

export const assistDecision = (
  signals: AssistSignals,
  threshold = assistThreshold,
): AssistDecision => {
  const confidence = assistConfidence(signals);
  return { show: confidence >= threshold, confidence };
};
