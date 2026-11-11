import { Effect, Layer, ManagedRuntime } from "effect";
import {
  answerCacheDefaults,
  answerCacheLayer,
} from "@/server/chat/AnswerCache";
import { GroundedChat } from "@/server/chat/GroundedChat";
import { CorpusDatabase } from "@/server/corpus/CorpusDatabase";
import { AnonymousSessions } from "@/server/gateway/AnonymousSessions";
import { GameCatalog } from "@/server/games/GameCatalog";
import {
  observedChat,
  observedRetrieval,
} from "@/server/metrics/GatewayMetrics";
import { ProCredentials } from "@/server/pro/ProCredentials";
import {
  chatProviders,
  firstTokenDeadline,
} from "@/server/provider/ChatModels";
import { CircuitBreaker } from "@/server/provider/CircuitBreaker";
import { Retriever } from "@/server/search/Retriever";
import { SearchResults } from "@/server/search/SearchResults";

const Chat = Layer.unwrap(
  Effect.gen(function* () {
    return observedChat.pipe(
      Layer.provide(answerCacheLayer(answerCacheDefaults)),
      Layer.provide(
        GroundedChat.layer(yield* chatProviders, yield* firstTokenDeadline),
      ),
    );
  }),
).pipe(Layer.provide(CircuitBreaker.layer));

const AppLayer = Layer.mergeAll(
  GameCatalog.layer,
  Chat,
  ProCredentials.layer,
  SearchResults.layer,
).pipe(
  Layer.provideMerge(AnonymousSessions.layer),
  Layer.provideMerge(observedRetrieval.pipe(Layer.provide(Retriever.layer))),
  Layer.provide(CorpusDatabase),
  Layer.orDie,
);

export const runtime = ManagedRuntime.make(AppLayer);
