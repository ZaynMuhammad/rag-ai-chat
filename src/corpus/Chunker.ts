import type { TextBlock } from "./ArticleBlocks";

export interface ChunkOptions {
  readonly maxTokens: number;
}

export interface Chunk {
  readonly ordinal: number;
  readonly sectionPath: ReadonlyArray<string>;
  readonly heading: string;
  readonly text: string;
  readonly tokenEstimate: number;
}

export const defaultChunkOptions: ChunkOptions = { maxTokens: 400 };

const tokensPerWord = 4 / 3;

export const estimateTokens = (text: string) => {
  const words = text.split(/\s+/).filter((word) => word !== "").length;
  return Math.ceil(words * tokensPerWord);
};

export const headingOf = (title: string, sectionPath: ReadonlyArray<string>) =>
  [title, ...sectionPath].join(" > ");

const sentenceBoundary = /(?<=[.!?]["”')\]]?)\s+(?=["“'(\[]?[A-Z0-9])/;

const splitWords = (text: string, maxTokens: number) => {
  const words = text.split(/\s+/);
  const wordsPerPiece = Math.max(1, Math.floor(maxTokens / tokensPerWord));
  return Array.from(
    { length: Math.ceil(words.length / wordsPerPiece) },
    (_, index) =>
      words.slice(index * wordsPerPiece, (index + 1) * wordsPerPiece).join(" "),
  );
};

const isList = (block: TextBlock) => block.text.includes("\n");

const piecesOf = (
  block: TextBlock,
  maxTokens: number,
): ReadonlyArray<string> => {
  if (estimateTokens(block.text) <= maxTokens) return [block.text];
  return block.text
    .split(isList(block) ? /\n/ : sentenceBoundary)
    .flatMap((piece) =>
      estimateTokens(piece) <= maxTokens
        ? [piece]
        : splitWords(piece, maxTokens),
    );
};

const sameSection = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((name, index) => name === b[index]);

interface PendingChunk {
  readonly sectionPath: ReadonlyArray<string>;
  text: string;
  tokens: number;
  lastBlock: TextBlock;
}

export const chunkArticle = (
  title: string,
  blocks: ReadonlyArray<TextBlock>,
  options: ChunkOptions = defaultChunkOptions,
): ReadonlyArray<Chunk> => {
  const chunks: Array<Chunk> = [];
  let pending: PendingChunk | undefined;

  const flush = () => {
    if (pending === undefined) return;
    chunks.push({
      ordinal: chunks.length,
      sectionPath: pending.sectionPath,
      heading: headingOf(title, pending.sectionPath),
      text: pending.text,
      tokenEstimate: estimateTokens(pending.text),
    });
    pending = undefined;
  };

  for (const block of blocks) {
    for (const piece of piecesOf(block, options.maxTokens)) {
      const tokens = estimateTokens(piece);
      if (
        pending !== undefined &&
        sameSection(pending.sectionPath, block.sectionPath) &&
        pending.tokens + tokens <= options.maxTokens
      ) {
        const separator =
          pending.lastBlock !== block ? "\n\n" : isList(block) ? "\n" : " ";
        pending.text = `${pending.text}${separator}${piece}`;
        pending.tokens += tokens;
        pending.lastBlock = block;
        continue;
      }
      flush();
      pending = {
        sectionPath: block.sectionPath,
        text: piece,
        tokens,
        lastBlock: block,
      };
    }
  }
  flush();
  return chunks;
};
