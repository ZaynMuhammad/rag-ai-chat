import { report, runLoad, steadyArrivals } from "./LoadRun";

const ratePerSecond = Number(process.env["LOAD_RPS"] ?? "4");
const multiplier = Number(process.env["LOAD_SPIKE_MULTIPLIER"] ?? "5");
const beforeSeconds = 20;
const spikeSeconds = 10;
const afterSeconds = 30;
const bucketSeconds = Number(process.env["LOAD_BUCKET_SECONDS"] ?? "5");

const arrivals = [
  ...steadyArrivals(ratePerSecond, beforeSeconds),
  ...steadyArrivals(
    ratePerSecond * multiplier,
    spikeSeconds,
    beforeSeconds * 1000,
  ),
  ...steadyArrivals(
    ratePerSecond,
    afterSeconds,
    (beforeSeconds + spikeSeconds) * 1000,
  ),
];

console.log(
  `${ratePerSecond}/s, then ${ratePerSecond * multiplier}/s from ${beforeSeconds}s to ${beforeSeconds + spikeSeconds}s`,
);
report(await runLoad(arrivals), bucketSeconds);
