import { evalQuestions, report, runLoad, steadyArrivals } from "./LoadRun";

const ratePerSecond = Number(process.env["LOAD_RPS"] ?? "4");
const durationSeconds = Number(process.env["LOAD_SECONDS"] ?? "60");

const exponent = Number(process.env["LOAD_ZIPF_EXPONENT"] ?? "1");
const seed = Number(process.env["LOAD_SEED"] ?? "1");

const seededRandom = (state: number) => () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const weights = evalQuestions.map((_, rank) => 1 / (rank + 1) ** exponent);
const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
const cumulative = weights.map(
  (
    (running) => (weight) =>
      (running += weight / totalWeight)
  )(0),
);

const random = seededRandom(seed);
const pick = () => {
  const draw = random();
  const rank = cumulative.findIndex((bound) => draw < bound);
  return evalQuestions[rank === -1 ? evalQuestions.length - 1 : rank] ?? "";
};

console.log(`zipf s=${exponent} seed=${seed}`);
report(await runLoad(steadyArrivals(ratePerSecond, durationSeconds), pick));
