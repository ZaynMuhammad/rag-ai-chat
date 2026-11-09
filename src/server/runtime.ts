import { Effect, Layer, ManagedRuntime } from "effect";
import { GroundedChat } from "@/server/chat/GroundedChat";
import { CorpusDatabase } from "@/server/corpus/CorpusDatabase";
import { AnonymousSessions } from "@/server/gateway/AnonymousSessions";
import { GameCatalog } from "@/server/games/GameCatalog";
import {
  chatProviders,
  firstTokenDeadline,
} from "@/server/provider/ChatModels";
import { CircuitBreaker } from "@/server/provider/CircuitBreaker";
import { Retriever } from "@/server/search/Retriever";

const Chat = Layer.unwrap(
  Effect.gen(function* () {
    return GroundedChat.layer(yield* chatProviders, yield* firstTokenDeadline);
  }),
).pipe(Layer.provide(CircuitBreaker.layer));

const AppLayer = Layer.mergeAll(
  GameCatalog.layer,
  Chat,
  AnonymousSessions.layer,
).pipe(
  Layer.provideMerge(Retriever.layer),
  Layer.provide(CorpusDatabase),
  Layer.orDie,
);

export const runtime = ManagedRuntime.make(AppLayer);
