import type { GroundedQuestion } from "@/server/chat/GroundedPrompt";
import { searchTerms } from "@/server/search/Retriever";

export const notCovered =
  "The articles I found don't cover that. Try naming the game, or widen the region or years.";

const maxSentences = 3;

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

export const extractiveAnswer = ({ question, passages }: GroundedQuestion) => {
  const terms = new Set(searchTerms(question));
  const minimumOverlap = terms.size >= 3 ? 2 : 1;
  const scored = passages.flatMap((passage, rank) =>
    sentences(passage.text).map((sentence, position) => ({
      sentence,
      number: passage.number,
      rank,
      position,
      overlap: searchTerms(sentence).filter((term) => terms.has(term)).length,
    })),
  );
  const chosen = scored
    .filter((candidate) => candidate.overlap >= minimumOverlap)
    .toSorted(
      (a, b) =>
        b.overlap - a.overlap || a.rank - b.rank || a.position - b.position,
    )
    .slice(0, maxSentences)
    .toSorted((a, b) => a.rank - b.rank || a.position - b.position);
  if (chosen.length === 0) return notCovered;
  return chosen
    .map(({ sentence, number }) => `${sentence} [${number}]`)
    .join(" ");
};
