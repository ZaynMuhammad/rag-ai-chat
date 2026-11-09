import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { ChatRequest } from "./ChatProtocol";

const accepts = Schema.is(ChatRequest);
const turn = {
  messages: [{ role: "user", content: "Who created Tetris?" }],
  scope: {},
};

describe("ChatRequest", () => {
  it("takes an optional model id, bounded in length", () => {
    assert.isTrue(accepts(turn));
    assert.isTrue(accepts({ ...turn, model: "llama3.2:3b" }));
    assert.isFalse(accepts({ ...turn, model: "" }));
    assert.isFalse(accepts({ ...turn, model: "x".repeat(101) }));
    assert.isFalse(accepts({ ...turn, model: 42 }));
  });
});
