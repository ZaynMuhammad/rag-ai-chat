import { Layer, ManagedRuntime } from "effect";
import { Chat } from "@/gateway/Chat";
import { MockProvider } from "@/gateway/Provider";
import { Retriever } from "@/rag/Retriever";

const AppLayer = Chat.layer.pipe(
  Layer.provide(Retriever.layer),
  Layer.provide(MockProvider.layer({ tokenDelay: "25 millis" })),
);

export const runtime = ManagedRuntime.make(AppLayer);
