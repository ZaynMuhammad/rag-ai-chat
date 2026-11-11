import { report, runLoad, steadyArrivals } from "./LoadRun";

const ratePerSecond = Number(process.env["LOAD_RPS"] ?? "4");
const durationSeconds = Number(process.env["LOAD_SECONDS"] ?? "60");
const bucketSeconds = Number(process.env["LOAD_BUCKET_SECONDS"] ?? "5");

console.log(
  "Expects the server to run with MOCK_PRIMARY=ok@15,hang@15,outage@15,ok",
);
report(
  await runLoad(steadyArrivals(ratePerSecond, durationSeconds)),
  bucketSeconds,
);
