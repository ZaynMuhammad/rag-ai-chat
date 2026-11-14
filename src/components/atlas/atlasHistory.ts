import { Option, Schema } from "effect";
import { ChatGame } from "@/lib/chats";

const GameView = Schema.Struct({
  game: ChatGame,
  chatId: Schema.String,
  focusPassageId: Schema.optionalKey(Schema.String),
});
export type GameView = typeof GameView.Type;

const AtlasView = Schema.Struct({
  place: Schema.NullOr(Schema.String),
  game: Schema.NullOr(GameView),
});
export type AtlasView = typeof AtlasView.Type;

const decodeHistoryState = Schema.decodeUnknownOption(
  Schema.Struct({ atlas: AtlasView }),
);

const closedView: AtlasView = { place: null, game: null };

export const viewInHistory = (state: unknown): AtlasView =>
  Option.match(decodeHistoryState(state), {
    onNone: () => closedView,
    onSome: ({ atlas }) => atlas,
  });

export const gamePath = (qid: string, passageId?: string) =>
  `/games/${encodeURIComponent(qid)}${
    passageId === undefined ? "" : `#${encodeURIComponent(passageId)}`
  }`;

export const pushView = (view: AtlasView, url?: string) => {
  window.history.pushState({ atlas: view }, "", url);
};

export const replaceView = (view: AtlasView) => {
  window.history.replaceState({ atlas: view }, "");
};

export const leaveView = () => {
  window.history.back();
};
