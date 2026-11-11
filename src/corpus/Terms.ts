export const words = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

export const countDocuments = (
  frequencies: Map<string, number>,
  document: string,
) => {
  for (const word of new Set(words(document))) {
    frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  }
};

export const commonTerms = (
  frequencies: ReadonlyMap<string, number>,
  documents: number,
  minimumShare: number,
) =>
  [...frequencies]
    .filter(([, count]) => count / documents >= minimumShare)
    .map(([term, count]) => ({ term, documents: count }))
    .sort((a, b) => b.documents - a.documents || a.term.localeCompare(b.term));
