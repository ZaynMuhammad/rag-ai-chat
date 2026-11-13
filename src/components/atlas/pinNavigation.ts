import type { Pin } from "@/server/games/GameProtocol";

export interface PlacedPin {
  readonly pin: Pin;
  readonly x: number;
  readonly y: number;
}

const arrows: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const sidewaysPenalty = 2;

export const nextPin = (
  placed: ReadonlyArray<PlacedPin>,
  from: PlacedPin,
  key: string,
): PlacedPin | undefined => {
  const arrow = arrows[key];
  if (arrow === undefined) return undefined;
  const [dx, dy] = arrow;
  let best: PlacedPin | undefined;
  let bestCost = Infinity;
  for (const candidate of placed) {
    const x = candidate.x - from.x;
    const y = candidate.y - from.y;
    const along = x * dx + y * dy;
    if (along <= 0) continue;
    const cost = along + sidewaysPenalty * Math.abs(x * dy - y * dx);
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best;
};

export const pinAt = (
  placed: ReadonlyArray<PlacedPin>,
  x: number,
  y: number,
  reach: (pin: Pin) => number,
): PlacedPin | undefined => {
  let best: PlacedPin | undefined;
  let bestDistance = Infinity;
  for (const candidate of placed) {
    const distance = Math.hypot(candidate.x - x, candidate.y - y);
    if (distance <= reach(candidate.pin) && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
};
