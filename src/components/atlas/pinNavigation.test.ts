import { describe, expect, it } from "@effect/vitest";
import type { Pin } from "@/server/games/GameProtocol";
import { nextPin } from "./pinNavigation";

const at = (label: string, x: number, y: number) => ({
  pin: {
    placeQid: label,
    label,
    kind: "studio" as const,
    latitude: 0,
    longitude: 0,
    games: 1,
  } satisfies Pin,
  x,
  y,
});

const origin = at("origin", 100, 100);
const ahead = at("ahead", 140, 100);
const diagonal = at("diagonal", 125, 125);
const behind = at("behind", 90, 100);
const placed = [origin, ahead, diagonal, behind];

describe("nextPin", () => {
  it("prefers the pin in line with the arrow over a nearer one off to the side", () => {
    expect(nextPin(placed, origin, "ArrowRight")).toBe(ahead);
  });

  it("only moves in the arrow's direction", () => {
    expect(nextPin(placed, origin, "ArrowLeft")).toBe(behind);
    expect(nextPin(placed, origin, "ArrowDown")).toBe(diagonal);
  });

  it("stays put when nothing lies that way", () => {
    expect(nextPin(placed, origin, "ArrowUp")).toBeUndefined();
  });

  it("ignores keys that are not arrows", () => {
    expect(nextPin(placed, origin, "Enter")).toBeUndefined();
  });
});
