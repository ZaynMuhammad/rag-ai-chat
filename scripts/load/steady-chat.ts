import { report, runLoad, steadyArrivals } from "./LoadRun";

const ratePerSecond = Number(process.env["LOAD_RPS"] ?? "4");
const durationSeconds = Number(process.env["LOAD_SECONDS"] ?? "60");

report(await runLoad(steadyArrivals(ratePerSecond, durationSeconds)));
