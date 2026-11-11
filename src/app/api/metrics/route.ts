import { connection } from "next/server";
import { bearerToken } from "@/app/bearer";
import { scrapeMetrics } from "@/server/metrics/MetricsScrape";
import { runtime } from "@/server/runtime";

export async function GET(request: Request) {
  await connection();
  return runtime.runPromise(scrapeMetrics(bearerToken(request)));
}
