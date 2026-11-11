import { Schema, Stream } from "effect";
import { type ChatEvent, ChatEventJson } from "./ChatProtocol";

const encodeEvent = Schema.encodeSync(ChatEventJson);
const decodeEvent = Schema.decodeUnknownSync(ChatEventJson);

export const toSseBody = (events: Stream.Stream<ChatEvent>) =>
  events.pipe(
    Stream.map((event) => `data: ${encodeEvent(event)}\n\n`),
    Stream.encodeText,
    Stream.toReadableStreamEffect(),
  );

export async function* readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (frame.startsWith("data: "))
        yield decodeEvent(frame.slice("data: ".length));
    }
  }
}
