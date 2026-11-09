import { Option, Schema } from "effect";
import { useSyncExternalStore } from "react";

export const CitedPassage = Schema.Struct({
  id: Schema.String,
  gameQid: Schema.String,
  title: Schema.String,
  released: Schema.NullOr(Schema.String),
  heading: Schema.String,
});
export type CitedPassage = typeof CitedPassage.Type;

export const UiMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  content: Schema.String,
  passages: Schema.Array(CitedPassage),
  model: Schema.NullOr(Schema.String),
  failed: Schema.Boolean,
});
export type UiMessage = typeof UiMessage.Type;

export const ChatGame = Schema.Struct({
  qid: Schema.String,
  title: Schema.String,
});
export type ChatGame = typeof ChatGame.Type;

export const StoredChat = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  game: Schema.NullOr(ChatGame),
  messages: Schema.Array(UiMessage),
  updatedAt: Schema.Number,
});
export type StoredChat = typeof StoredChat.Type;

const storageKey = "game-atlas.chats";
const keptChats = 50;
const noChats: ReadonlyArray<StoredChat> = [];
const decodeChats = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(StoredChat)),
);

let cached: ReadonlyArray<StoredChat> | undefined;
const listeners = new Set<() => void>();

const withStorage = <A>(access: (storage: Storage) => A, fallback: A) => {
  try {
    return access(localStorage);
  } catch {
    return fallback;
  }
};

const readStorage = () =>
  withStorage((storage) => {
    const raw = storage.getItem(storageKey);
    return raw === null
      ? noChats
      : Option.getOrElse(decodeChats(raw), () => noChats);
  }, noChats);

const snapshot = () => (cached ??= readStorage());

const write = (chats: ReadonlyArray<StoredChat>) => {
  cached = chats;
  withStorage((storage) => {
    storage.setItem(storageKey, JSON.stringify(chats));
  }, undefined);
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) return;
    cached = undefined;
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

export const useChats = () =>
  useSyncExternalStore(subscribe, snapshot, () => noChats);

export const findChat = (id: string) =>
  snapshot().find((chat) => chat.id === id);

export const saveChat = (chat: StoredChat) => {
  write(
    [chat, ...snapshot().filter((other) => other.id !== chat.id)].slice(
      0,
      keptChats,
    ),
  );
};

export const deleteChat = (id: string) => {
  write(snapshot().filter((chat) => chat.id !== id));
};

export const citedPassage = ({
  id,
  gameQid,
  title,
  released,
  heading,
}: CitedPassage): CitedPassage => ({ id, gameQid, title, released, heading });
