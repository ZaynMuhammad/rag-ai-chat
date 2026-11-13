import { describe, expect, it } from "@effect/vitest";
import { deleteChat, findChat, saveChat, type StoredChat } from "./chats";

const chat = (id: string): StoredChat => ({
  id,
  title: "Who made Tetris?",
  game: null,
  messages: [],
  updatedAt: 1,
});

describe("chats", () => {
  it("keeps a deleted chat deleted when an answer still streaming saves it", () => {
    saveChat(chat("streaming"));
    deleteChat("streaming");
    saveChat(chat("streaming"));
    expect(findChat("streaming")).toBeUndefined();
  });

  it("still saves other chats after one is deleted", () => {
    saveChat(chat("kept"));
    deleteChat("gone");
    saveChat({ ...chat("kept"), updatedAt: 2 });
    expect(findChat("kept")?.updatedAt).toBe(2);
  });
});
