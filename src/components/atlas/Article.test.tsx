import { describe, expect, it } from "@effect/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameDetail } from "@/server/games/GameProtocol";
import { ArticleText } from "./Article";

const passage = (index: number, heading: string) => ({
  id: `Q1#${index}`,
  heading,
  text: `Passage ${index}.`,
});

const game: GameDetail = {
  qid: "Q1",
  title: "Star Fox",
  released: "2026",
  description: null,
  url: null,
  revisionId: null,
  origins: [],
  studios: [],
  genres: [],
  passages: [
    passage(0, "Star Fox"),
    passage(1, "Star Fox > Gameplay"),
    passage(2, "Star Fox > Gameplay"),
    passage(3, "Star Fox > Reception"),
    passage(4, "Star Fox > Gameplay"),
  ],
};

const headings = (html: string) =>
  [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((match) => match[1]);

describe("ArticleText", () => {
  it("names a section once when it continues across passages", () => {
    const html = renderToStaticMarkup(<ArticleText game={game} />);
    expect(headings(html)).toEqual(["Gameplay", "Reception", "Gameplay"]);
  });

  it("keeps every passage addressable for citations", () => {
    const html = renderToStaticMarkup(<ArticleText game={game} />);
    for (const { id } of game.passages) expect(html).toContain(`id="${id}"`);
  });
});
