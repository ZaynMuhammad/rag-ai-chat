import { assert, describe, it } from "@effect/vitest";
import { Stream } from "effect";
import type { ChatEvent } from "./ChatProtocol";
import { readSse, toSseBody } from "./sse";

const events: Array<ChatEvent> = [
  { _tag: "Citations", passages: [] },
  { _tag: "Delta", text: "Hello, " },
  { _tag: "Delta", text: "wörld\n\nwith blank lines" },
  { _tag: "Done", model: "mock" },
];

const rechunk = async (body: ReadableStream<Uint8Array>, size: number) => {
  const bytes = new Uint8Array(await new Response(body).arrayBuffer());
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += size) {
        controller.enqueue(bytes.slice(offset, offset + size));
      }
      controller.close();
    },
  });
};

describe("sse", () => {
  it("round-trips events when chunks split frames and multibyte characters", async () => {
    const body = await rechunk(toSseBody(Stream.fromIterable(events)), 3);
    const decoded = await Array.fromAsync(readSse(body));
    assert.deepStrictEqual(decoded, events);
  });
});
