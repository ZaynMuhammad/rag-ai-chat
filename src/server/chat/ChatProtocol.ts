import { Schema } from "effect";
import { Scope } from "@/server/games/Scope";
import { RetrievedPassage } from "@/server/search/Passage";

export const ChatMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  content: Schema.String.check(Schema.isMaxLength(2000)),
});
export type ChatMessage = typeof ChatMessage.Type;

export const ModelId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
);

export const ChatModelInfo = Schema.Struct({
  id: ModelId,
  provider: Schema.String,
});
export type ChatModelInfo = typeof ChatModelInfo.Type;

export const ChatModelList = Schema.Struct({
  models: Schema.Array(ChatModelInfo),
  default: ModelId,
});
export type ChatModelList = typeof ChatModelList.Type;

export const ChatRequest = Schema.Struct({
  messages: Schema.Array(ChatMessage).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
  ),
  scope: Scope,
  model: Schema.optional(ModelId),
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
