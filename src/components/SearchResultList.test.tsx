import { describe, expect, it } from "@effect/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SearchHit } from "@/server/search/SearchProtocol";
import { SearchResultList } from "./SearchResultList";

const hit: SearchHit = {
  qid: "Q3",
  title: "Script Kiddie",
  released: "2001",
  passageId: "Q3#0",
  heading: "Script Kiddie > Reception",
  url: "https://en.wikipedia.org/wiki/Script_Kiddie",
  revisionId: 1000,
  score: 12,
  snippet: [
    { text: '<script>alert("pwned")</script> and ', matched: false },
    { text: "<img src=x onerror=alert(1)>", matched: true },
  ],
};

describe("SearchResultList", () => {
  it("renders snippet text escaped, so stored markup never runs", () => {
    const html = renderToStaticMarkup(<SearchResultList results={[hit]} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<mark");
  });

  it("links out to the Wikipedia revision without sending a referrer", () => {
    const html = renderToStaticMarkup(<SearchResultList results={[hit]} />);
    expect(html).toContain(
      '<a href="https://en.wikipedia.org/w/index.php?oldid=1000" rel="noreferrer"',
    );
    expect(html).toContain('href="/games/Q3#Q3%230"');
  });
});
