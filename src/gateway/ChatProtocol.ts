import { Schema } from "effect";
import { ArticleId, Passage } from "@/rag/Article";

export const ChatMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  content: Schema.String.check(Schema.isMaxLength(4000)),
});
export type ChatMessage = typeof ChatMessage.Type;

export const ChatRequest = Schema.Struct({
  messages: Schema.Array(ChatMessage).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  articleIds: Schema.Array(ArticleId).check(Schema.isMaxLength(50)),
});
export type ChatRequest = typeof ChatRequest.Type;

export const ChatEvent = Schema.Union([
  Schema.TaggedStruct("Citations", { passages: Schema.Array(Passage) }),
  Schema.TaggedStruct("Delta", { text: Schema.String }),
  Schema.TaggedStruct("Failed", { message: Schema.String }),
  Schema.TaggedStruct("Done", {}),
]);
export type ChatEvent = typeof ChatEvent.Type;

export const ChatEventJson = Schema.fromJsonString(ChatEvent);
