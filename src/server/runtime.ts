import { Effect, Layer, ManagedRuntime } from "effect";
import { GroundedChat } from "@/server/chat/GroundedChat";
import { CorpusDatabase } from "@/server/corpus/CorpusDatabase";
import { GameCatalog } from "@/server/games/GameCatalog";
import { chatPlan } from "@/server/provider/ChatModels";
import { Retriever } from "@/server/search/Retriever";

const Chat = Layer.unwrap(Effect.map(chatPlan, GroundedChat.layer));

const AppLayer = Layer.mergeAll(GameCatalog.layer, Chat).pipe(
  Layer.provideMerge(Retriever.layer),
  Layer.provide(CorpusDatabase),
  Layer.orDie,
);

export const runtime = ManagedRuntime.make(AppLayer);
