import { describe, expect, it } from "@effect/vitest";
import { hotpotQuestion, kiltNqQuestion } from "./BenchmarkSources";

const qidByTitle = new Map([
  ["Limbo (video game)", "Q1"],
  ["Inside (video game)", "Q2"],
  ["Red Dead Redemption", "Q3"],
]);

const hotpot = {
  id: "h1",
  question: "Which studio made both Limbo and Inside? ",
  answer: "Playdead",
  type: "bridge",
  level: "medium",
  supporting_facts: {
    title: ["Limbo (video game)", "Inside (video game)", "Inside (video game)"],
    sent_id: [0, 0, BigInt(2)],
  },
  context: {
    title: ["Unrelated", "Inside (video game)", "Limbo (video game)"],
    sentences: [
      ["Not evidence."],
      ["Inside is a 2016 game.", "It is dark.", "Playdead developed it."],
      ["Limbo is a 2010 game by Playdead."],
    ],
  },
};

describe("hotpotQuestion", () => {
  it("collects each article's supporting sentences from the shuffled context", () => {
    const question = hotpotQuestion(hotpot, qidByTitle);

    expect(
      question?.gold.map((article) => [article.qid, article.evidence]),
    ).toEqual([
      ["Q1", ["Limbo is a 2010 game by Playdead."]],
      ["Q2", ["Inside is a 2016 game.", "Playdead developed it."]],
    ]);
    expect(question?.question).toBe("Which studio made both Limbo and Inside?");
    expect(question?.tags).toEqual(["multi_hop", "bridge", "medium"]);
  });

  it("drops questions that need an article outside the video game corpus", () => {
    const outside = {
      ...hotpot,
      supporting_facts: {
        title: ["Limbo (video game)", "Playdead"],
        sent_id: [0, 0],
      },
    };

    expect(hotpotQuestion(outside, qidByTitle)).toBeUndefined();
  });
});

describe("kiltNqQuestion", () => {
  const nq = {
    id: "n1",
    input: "when did red dead redemption 1 come out",
    output: [
      { answer: "May 2010", provenance: [{ title: "Red Dead Redemption" }] },
      {
        answer: "May 18 , 2010",
        provenance: [{ title: "Red Dead Redemption" }],
      },
      { answer: "", provenance: [{ title: "Red Dead Redemption" }] },
      {
        answer:
          "it was released for the PlayStation 3 and Xbox 360 consoles in May 2010 worldwide",
        provenance: [],
      },
    ],
  };

  it("keeps short answers as evidence for every provenance article", () => {
    const question = kiltNqQuestion(nq, qidByTitle);

    expect(question?.answers).toEqual(["May 2010", "May 18 , 2010"]);
    expect(
      question?.gold.map((article) => [article.qid, article.evidence]),
    ).toEqual([["Q3", ["May 2010", "May 18 , 2010"]]]);
  });

  it("drops questions whose answer depended on when they were asked", () => {
    const dated = { ...nq, input: "when is the next yoshi game coming out" };

    expect(kiltNqQuestion(dated, qidByTitle)).toBeUndefined();
  });

  it("drops questions whose provenance points outside the corpus", () => {
    const outside = {
      ...nq,
      output: [{ answer: "79", provenance: [{ title: "Tiger Woods" }] }],
    };

    expect(kiltNqQuestion(outside, qidByTitle)).toBeUndefined();
  });
});
