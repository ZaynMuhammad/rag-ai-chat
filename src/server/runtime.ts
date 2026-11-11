import { Effect, Layer, ManagedRuntime } from "effect";
import { GroundedChat } from "@/server/chat/GroundedChat";
import { CorpusDatabase } from "@/server/corpus/CorpusDatabase";
import { AnonymousSessions } from "@/server/gateway/AnonymousSessions";
import { GameCatalog } from "@/server/games/GameCatalog";
import { ProCredentials } from "@/server/pro/ProCredentials";
import { chatPlan } from "@/server/provider/ChatModels";
import { Retriever } from "@/server/search/Retriever";

const Chat = Layer.unwrap(Effect.map(chatPlan, GroundedChat.layer));

const AppLayer = Layer.mergeAll(
  GameCatalog.layer,
  Chat,
  ProCredentials.layer,
).pipe(
  Layer.provideMerge(AnonymousSessions.layer),
  Layer.provideMerge(Retriever.layer),
  Layer.provide(CorpusDatabase),
  Layer.orDie,
);

export const runtime = ManagedRuntime.make(AppLayer);
