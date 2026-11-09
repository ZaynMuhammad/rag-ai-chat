import { Effect, Layer, ManagedRuntime } from "effect";
import {
  answerCacheDefaults,
  answerCacheLayer,
} from "@/server/chat/AnswerCache";
import { GroundedChat } from "@/server/chat/GroundedChat";
import { CorpusDatabase } from "@/server/corpus/CorpusDatabase";
import { AnonymousSessions } from "@/server/gateway/AnonymousSessions";
import { GameCatalog } from "@/server/games/GameCatalog";
import { chatPlan, chatPlanIdentity } from "@/server/provider/ChatModels";
import { Retriever } from "@/server/search/Retriever";

const Chat = Layer.unwrap(
  Effect.gen(function* () {
    const plan = yield* chatPlan;
    const planIdentity = yield* chatPlanIdentity;
    return answerCacheLayer({ ...answerCacheDefaults, planIdentity }).pipe(
      Layer.provide(GroundedChat.layer(plan)),
    );
  }),
);

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
