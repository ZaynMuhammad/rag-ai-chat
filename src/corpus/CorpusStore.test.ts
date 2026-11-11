import { describe, expect, it } from "@effect/vitest";
import { latestRevisionPerGame } from "./CorpusStore";
import type { StructuredArticle } from "./StructuredWikipedia";

const article = (qid: string, revisionId: number): StructuredArticle => ({
  qid,
  title: qid,
  pageId: 1,
  revisionId,
  url: `https://en.wikipedia.org/wiki/${qid}`,
  description: null,
  sections: [],
});

describe("latestRevisionPerGame", () => {
  it("keeps one article per game, the newest revision, when a shard repeats a game", () => {
    const articles = [
      article("Q1", 10),
      article("Q2", 5),
      article("Q1", 12),
      article("Q1", 11),
    ];

    expect(
      latestRevisionPerGame(articles, (item) => item).map((item) => [
        item.qid,
        item.revisionId,
      ]),
    ).toEqual([
      ["Q1", 12],
      ["Q2", 5],
    ]);
  });
});
