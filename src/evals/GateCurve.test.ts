import { describe, expect, it } from "@effect/vitest";
import {
  type GateSample,
  gatePoint,
  operatingPoint,
  gateCurve,
  rocAuc,
  wilsonInterval,
} from "./GateCurve";

const sample = (
  confidence: number,
  shouldShow: boolean,
  answerable = true,
): GateSample => ({ confidence, shouldShow, answerable });

const samples = [
  sample(0.95, true),
  sample(0.9, true),
  sample(0.85, false),
  sample(0.6, true),
  sample(0.55, false, false),
  sample(0.2, false),
];

describe("gate curve", () => {
  it("counts shown, wrong, missed and unanswerable answers at a threshold", () => {
    expect(gatePoint(samples, 0.5)).toMatchObject({
      shown: 5,
      correctShown: 3,
      wrongShown: 2,
      missed: 0,
      unanswerableShown: 1,
      precision: 0.6,
      recall: 1,
    });
    expect(gatePoint(samples, 0.88)).toMatchObject({
      shown: 2,
      missed: 1,
      precision: 1,
      recall: 0.667,
      triggerRate: 0.333,
    });
  });

  it("picks the cheapest threshold, preferring the stricter one on a tie", () => {
    expect(operatingPoint(gateCurve(samples), 0.5)?.threshold).toBe(0.6);
    expect(operatingPoint(gateCurve(samples), 1)?.threshold).toBe(0.9);
  });

  it("counts a tied score as half a win in the AUC", () => {
    expect(
      rocAuc([
        { score: 0.9, positive: true },
        { score: 0.5, positive: true },
        { score: 0.5, positive: false },
        { score: 0.1, positive: false },
      ]),
    ).toBe(0.875);
  });

  it("gives a wide Wilson interval for a small sample", () => {
    expect(wilsonInterval(8, 10)).toEqual([0.49, 0.943]);
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });
});
