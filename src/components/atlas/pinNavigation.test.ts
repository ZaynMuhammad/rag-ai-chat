import { describe, expect, it } from "@effect/vitest";
import type { Pin } from "@/server/games/GameProtocol";
import { nextPin, pinAt } from "./pinNavigation";

const at = (label: string, x: number, y: number, games = 1) => ({
  pin: {
    placeQid: label,
    label,
    kind: "studio" as const,
    latitude: 0,
    longitude: 0,
    games,
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

describe("pinAt", () => {
  const london = at("London", 100, 100, 332);
  const nottingHill = at("Notting Hill", 100.3, 100);
  const tonbridge = at("Tonbridge", 102.4, 100);
  const lonely = at("Lonely", 160, 100);
  const paintedSmallestLast = [london, nottingHill, tonbridge, lonely];
  const drawn = (pin: Pin) => (pin.games > 100 ? 8 : 3);

  it("picks a large pin when its centre is tapped, even with smaller ones on top", () => {
    expect(pinAt(paintedSmallestLast, 100, 100, drawn, 0)).toBe(london);
    expect(pinAt(paintedSmallestLast, 100.2, 100, drawn, 0)).toBe(london);
  });

  it("still reaches a small pin when its own centre is tapped", () => {
    expect(pinAt(paintedSmallestLast, 102.4, 100, drawn, 0)).toBe(tonbridge);
  });

  it("lets a touch land a finger's width away from a tiny pin", () => {
    expect(pinAt(paintedSmallestLast, 175, 100, drawn, 3)).toBeUndefined();
    expect(pinAt(paintedSmallestLast, 175, 100, drawn, 22)).toBe(lonely);
  });

  it("prefers a pin under the finger over a nearer miss", () => {
    expect(pinAt(paintedSmallestLast, 107, 100, drawn, 22)).toBe(london);
  });

  it("finds nothing away from every pin", () => {
    expect(pinAt(paintedSmallestLast, 300, 300, drawn, 22)).toBeUndefined();
  });
});
