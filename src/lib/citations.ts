export type AnswerSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "citation"; readonly number: number };

const citationPattern = /\[(\d{1,2})\]/g;

export const answerSegments = (
  answer: string,
  sourceCount: number,
): ReadonlyArray<AnswerSegment> => {
  const segments: Array<AnswerSegment> = [];
  let cursor = 0;
  for (const match of answer.matchAll(citationPattern)) {
    const number = Number(match[1]);
    if (number < 1 || number > sourceCount) continue;
    if (match.index > cursor) {
      segments.push({ kind: "text", text: answer.slice(cursor, match.index) });
    }
    segments.push({ kind: "citation", number });
    cursor = match.index + match[0].length;
  }
  if (cursor < answer.length) {
    segments.push({ kind: "text", text: answer.slice(cursor) });
  }
  return segments;
};

export const citedNumbers = (answer: string, sourceCount: number) =>
  new Set(
    answerSegments(answer, sourceCount).flatMap((segment) =>
      segment.kind === "citation" ? [segment.number] : [],
    ),
  );
