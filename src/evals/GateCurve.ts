export interface GateSample {
  readonly confidence: number;
  readonly shouldShow: boolean;
  readonly answerable: boolean;
}

export interface GatePoint {
  readonly threshold: number;
  readonly shown: number;
  readonly correctShown: number;
  readonly wrongShown: number;
  readonly missed: number;
  readonly unanswerableShown: number;
  readonly triggerRate: number;
  readonly precision: number;
  readonly recall: number;
  readonly precisionInterval: readonly [number, number];
}

const round = (value: number) => Number(value.toFixed(3));

export const rocAuc = (
  scored: ReadonlyArray<{ readonly score: number; readonly positive: boolean }>,
) => {
  const positives = scored.filter((sample) => sample.positive);
  const negatives = scored.filter((sample) => !sample.positive);
  if (positives.length === 0 || negatives.length === 0) return 0.5;
  const wins = positives.reduce(
    (total, positive) =>
      total +
      negatives.reduce(
        (sum, negative) =>
          sum +
          (positive.score > negative.score
            ? 1
            : positive.score === negative.score
              ? 0.5
              : 0),
        0,
      ),
    0,
  );
  return wins / (positives.length * negatives.length);
};

export const wilsonInterval = (
  successes: number,
  trials: number,
): readonly [number, number] => {
  if (trials === 0) return [0, 1];
  const z = 1.96;
  const share = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = share + (z * z) / (2 * trials);
  const spread =
    z * Math.sqrt((share * (1 - share)) / trials + (z * z) / (4 * trials ** 2));
  return [
    round((centre - spread) / denominator),
    round((centre + spread) / denominator),
  ];
};

export const gatePoint = (
  samples: ReadonlyArray<GateSample>,
  threshold: number,
): GatePoint => {
  const shown = samples.filter((sample) => sample.confidence >= threshold);
  const correctShown = shown.filter((sample) => sample.shouldShow).length;
  const shouldShow = samples.filter((sample) => sample.shouldShow).length;
  return {
    threshold,
    shown: shown.length,
    correctShown,
    wrongShown: shown.length - correctShown,
    missed: shouldShow - correctShown,
    unanswerableShown: shown.filter((sample) => !sample.answerable).length,
    triggerRate: round(shown.length / Math.max(1, samples.length)),
    precision: shown.length === 0 ? 1 : round(correctShown / shown.length),
    recall: shouldShow === 0 ? 0 : round(correctShown / shouldShow),
    precisionInterval: wilsonInterval(correctShown, shown.length),
  };
};

export const thresholds = Array.from({ length: 21 }, (_, step) => step / 20);

export const gateCurve = (samples: ReadonlyArray<GateSample>) =>
  thresholds.map((threshold) => gatePoint(samples, threshold));

export const gateCost = (point: GatePoint, wrongAnswerCost: number) =>
  wrongAnswerCost * point.wrongShown + point.missed;

export const operatingPoint = (
  curve: ReadonlyArray<GatePoint>,
  wrongAnswerCost: number,
) =>
  curve.reduce<GatePoint | undefined>(
    (best, point) =>
      best === undefined ||
      gateCost(point, wrongAnswerCost) <= gateCost(best, wrongAnswerCost)
        ? point
        : best,
    undefined,
  );
