import { describe, expect, it } from "@effect/vitest";
import { chunkArticle, estimateTokens } from "./Chunker";

const words = (count: number, word = "word") =>
  Array.from({ length: count }, () => word).join(" ");
const sentence = (count: number) => `Start ${words(count - 2)} end.`;

describe("chunkArticle", () => {
  it("packs paragraphs of one section together and prefixes the heading", () => {
    const chunks = chunkArticle(
      "Tetris",
      [
        { sectionPath: ["Gameplay"], text: "Pieces fall." },
        { sectionPath: ["Gameplay"], text: "Lines clear." },
      ],
      { maxTokens: 100 },
    );

    expect(chunks).toEqual([
      {
        ordinal: 0,
        sectionPath: ["Gameplay"],
        heading: "Tetris > Gameplay",
        text: "Pieces fall.\n\nLines clear.",
        tokenEstimate: 6,
      },
    ]);
  });

  it("never merges text from different sections", () => {
    const chunks = chunkArticle(
      "Tetris",
      [
        { sectionPath: [], text: "A puzzle game." },
        { sectionPath: ["Reception"], text: "Critics loved it." },
      ],
      { maxTokens: 100 },
    );

    expect(chunks.map((chunk) => chunk.heading)).toEqual([
      "Tetris",
      "Tetris > Reception",
    ]);
  });

  it("starts a new chunk when the next paragraph would exceed the budget", () => {
    const chunks = chunkArticle(
      "Doom",
      [
        { sectionPath: ["Plot"], text: words(30) },
        { sectionPath: ["Plot"], text: words(30) },
      ],
      { maxTokens: 60 },
    );

    expect(chunks.map((chunk) => chunk.tokenEstimate)).toEqual([40, 40]);
  });

  it("splits an oversized paragraph at sentence boundaries and rejoins sentences with spaces", () => {
    const paragraph = [sentence(20), sentence(20), sentence(20)].join(" ");
    const chunks = chunkArticle(
      "Myst",
      [{ sectionPath: [], text: paragraph }],
      { maxTokens: 60 },
    );

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      `${sentence(20)} ${sentence(20)}`,
      sentence(20),
    ]);
    expect(chunks.every((chunk) => chunk.tokenEstimate <= 60)).toBe(true);
  });

  it("splits an oversized list between items", () => {
    const list = [`- ${words(29)}`, `- ${words(29)}`].join("\n");
    const chunks = chunkArticle(
      "Zork",
      [{ sectionPath: ["Items"], text: list }],
      { maxTokens: 50 },
    );

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      `- ${words(29)}`,
      `- ${words(29)}`,
    ]);
  });

  it("hard-splits a single sentence longer than the budget", () => {
    const chunks = chunkArticle(
      "Elite",
      [{ sectionPath: [], text: words(100) }],
      { maxTokens: 40 },
    );

    expect(chunks.every((chunk) => chunk.tokenEstimate <= 40)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join(" ")).toBe(words(100));
  });
});

describe("estimateTokens", () => {
  it("counts about four tokens for every three words", () => {
    expect(estimateTokens("one two three")).toBe(4);
    expect(estimateTokens("  ")).toBe(0);
  });
});
