import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { ArticleSections, articleBlocks } from "./ArticleBlocks";

const decodeSections = Schema.decodeUnknownSync(ArticleSections);

describe("articleBlocks", () => {
  it("keeps the lead section at the article root and nests subsection names", () => {
    const sections = decodeSections(
      JSON.stringify([
        {
          type: "section",
          name: "Abstract",
          has_parts: [{ type: "paragraph", value: "Tetris is a puzzle game." }],
        },
        {
          type: "section",
          name: "Development",
          has_parts: [
            { type: "paragraph", value: "Pajitnov wrote it." },
            {
              type: "section",
              name: "Release",
              has_parts: [{ type: "paragraph", value: "It shipped in 1985." }],
            },
          ],
        },
      ]),
    );

    expect(articleBlocks(sections)).toEqual([
      { sectionPath: [], text: "Tetris is a puzzle game." },
      { sectionPath: ["Development"], text: "Pajitnov wrote it." },
      { sectionPath: ["Development", "Release"], text: "It shipped in 1985." },
    ]);
  });

  it("renders lists as one block of marked lines and drops tables and images", () => {
    const sections = decodeSections(
      JSON.stringify([
        {
          type: "section",
          name: "Characters",
          has_parts: [
            { type: "table", table_references: [{ identifier: "t1" }] },
            { type: "image", images: [] },
            {
              type: "ordered_list",
              has_parts: [
                { type: "list_item", value: "Mario" },
                {
                  type: "list_item",
                  value: "Luigi",
                  has_parts: [
                    {
                      type: "list",
                      has_parts: [
                        { type: "list_item", value: "Younger brother" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );

    expect(articleBlocks(sections)).toEqual([
      {
        sectionPath: ["Characters"],
        text: "1. Mario\n2. Luigi\n  - Younger brother",
      },
    ]);
  });

  it("collapses whitespace and skips empty paragraphs", () => {
    const sections = decodeSections(
      JSON.stringify([
        {
          type: "section",
          name: "Abstract",
          has_parts: [
            { type: "paragraph", value: "  A\n\tgame  " },
            { type: "paragraph", value: "   " },
          ],
        },
      ]),
    );

    expect(articleBlocks(sections)).toEqual([
      { sectionPath: [], text: "A game" },
    ]);
  });
});
