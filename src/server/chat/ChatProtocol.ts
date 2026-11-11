import { Schema } from "effect";
import { Scope } from "@/server/games/Scope";
import { RetrievedPassage } from "@/server/search/Passage";

export const ChatMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  content: Schema.String.check(Schema.isMaxLength(2000)),
});
export type ChatMessage = typeof ChatMessage.Type;

export const ChatRequest = Schema.Struct({
  messages: Schema.Array(ChatMessage).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
  ),
  scope: Scope,
});
export type ChatRequest = typeof ChatRequest.Type;

export const ChatEvent = Schema.Union([
  Schema.TaggedStruct("Citations", {
    passages: Schema.Array(RetrievedPassage),
  }),
  Schema.TaggedStruct("Delta", { text: Schema.String }),
  Schema.TaggedStruct("Failed", { message: Schema.String }),
  Schema.TaggedStruct("Done", { model: Schema.NullOr(Schema.String) }),
]);
export type ChatEvent = typeof ChatEvent.Type;

export const ChatEventJson = Schema.fromJsonString(ChatEvent);
