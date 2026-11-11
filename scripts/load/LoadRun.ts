import { readFileSync, readdirSync } from "node:fs";

export const base = process.env["LOAD_BASE_URL"] ?? "http://localhost:3000";
const timeoutMs = Number(process.env["LOAD_TIMEOUT_MS"] ?? "30000");
const metricsToken = process.env["LOAD_METRICS_TOKEN"];
const requestsPerSession = 6;
const maxSessions = 110;

const evalDirectory = new URL("../../evals/games/", import.meta.url);
export const evalQuestions = readdirSync(evalDirectory)
  .filter((file) => file.endsWith(".jsonl"))
  .toSorted()
  .flatMap((file) =>
    readFileSync(new URL(file, evalDirectory), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => (JSON.parse(line) as { question: string }).question),
  );

export interface Sample {
  readonly sentAtMs: number;
  readonly status: number;
  readonly firstTokenMs: number | undefined;
  readonly totalMs: number;
  readonly failed: boolean;
  readonly timedOut: boolean;
  readonly model: string | null;
}

const mintSession = async () => {
  const response = await fetch(`${base}/api/session`, { method: "POST" });
  if (!response.ok) throw new Error(`session ${response.status}`);
  return ((await response.json()) as { token: string }).token;
};

const answeredBy = (text: string) => {
  const match = /"_tag":"Done","model":"([^"]*)"/.exec(text);
  return match?.[1] ?? null;
};

const ask = async (
  token: string,
  question: string,
  sentAtMs: number,
): Promise<Sample> => {
  const start = performance.now();
  let status = 0;
  let text = "";
  let firstTokenMs: number | undefined;
  try {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: question }],
        scope: {},
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    if (!response.ok || response.body === null) {
      return {
        sentAtMs,
        status,
        firstTokenMs,
        totalMs: performance.now() - start,
        failed: true,
        timedOut: false,
        model: null,
      };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (firstTokenMs === undefined && text.includes('"_tag":"Delta"')) {
        firstTokenMs = performance.now() - start;
      }
    }
  } catch {
    return {
      sentAtMs,
      status,
      firstTokenMs,
      totalMs: performance.now() - start,
      failed: true,
      timedOut: true,
      model: null,
    };
  }
  return {
    sentAtMs,
    status,
    firstTokenMs,
    totalMs: performance.now() - start,
    failed: text.includes('"_tag":"Failed"'),
    timedOut: false,
    model: answeredBy(text),
  };
};

export const steadyArrivals = (
  ratePerSecond: number,
  durationSeconds: number,
  offsetMs = 0,
) =>
  Array.from(
    { length: Math.round(ratePerSecond * durationSeconds) },
    (_, index) => offsetMs + (index * 1000) / ratePerSecond,
  );

type CacheResults = Record<string, number> | undefined;

const cacheResults = async (): Promise<CacheResults> => {
  const response = await fetch(`${base}/api/metrics`, {
    headers:
      metricsToken === undefined
        ? {}
        : { authorization: `Bearer ${metricsToken}` },
  });
  if (!response.ok) return undefined;
  const exposition = await response.text();
  return Object.fromEntries(
    [
      ...exposition.matchAll(
        /^answer_cache_requests_total\{result="(\w+)"\} (\d+)$/gm,
      ),
    ].map(([, result, count]) => [result ?? "", Number(count)]),
  );
};

const cacheHitRate = (before: CacheResults, after: CacheResults) => {
  if (before === undefined || after === undefined) return "n/a";
  const delta = (result: string) =>
    (after[result] ?? 0) - (before[result] ?? 0);
  const served = delta("hit") + delta("coalesced");
  const cacheable = served + delta("miss");
  return {
    hits: delta("hit"),
    coalesced: delta("coalesced"),
    misses: delta("miss"),
    hitRate:
      cacheable === 0 ? 0 : Number((delta("hit") / cacheable).toFixed(4)),
    servedWithoutUpstream:
      cacheable === 0 ? 0 : Number((served / cacheable).toFixed(4)),
  };
};

export interface LoadResult {
  readonly samples: ReadonlyArray<Sample>;
  readonly cache: ReturnType<typeof cacheHitRate>;
}

const cycleEvalQuestions = (index: number) =>
  evalQuestions[index % evalQuestions.length] ?? "";

export const runLoad = async (
  arrivalsMs: ReadonlyArray<number>,
  questionAt: (index: number) => string = cycleEvalQuestions,
): Promise<LoadResult> => {
  const sessionCount = Math.min(
    maxSessions,
    Math.ceil(arrivalsMs.length / requestsPerSession),
  );
  const sessions = await Promise.all(
    Array.from({ length: sessionCount }, mintSession),
  );
  console.log(
    `${arrivalsMs.length} chats over ${Math.round((arrivalsMs.at(-1) ?? 0) / 1000)}s, ${sessionCount} sessions, ${base}`,
  );
  const before = await cacheResults();
  const pending: Array<Promise<Sample>> = [];
  const started = performance.now();
  for (const [index, offset] of arrivalsMs.entries()) {
    const wait = started + offset - performance.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const token = sessions[index % sessions.length] ?? "";
    pending.push(ask(token, questionAt(index), offset));
  }
  const samples = await Promise.all(pending);
  return { samples, cache: cacheHitRate(before, await cacheResults()) };
};

const percentile = (values: ReadonlyArray<number>, p: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return Math.round(
    sorted.at(Math.min(sorted.length - 1, Math.floor(p * sorted.length))) ?? 0,
  );
};

const counts = (values: ReadonlyArray<string | number | null>) =>
  JSON.stringify(
    Object.fromEntries(
      [...Map.groupBy(values, (value) => String(value))].map(([key, group]) => [
        key,
        group.length,
      ]),
    ),
  );

const isOk = (sample: Sample) => sample.status === 200 && !sample.failed;

const summarize = (samples: ReadonlyArray<Sample>) => {
  const ok = samples.filter(isOk);
  const firstTokens = ok.flatMap((sample) =>
    sample.firstTokenMs === undefined ? [] : [sample.firstTokenMs],
  );
  return {
    requests: samples.length,
    errorRate: Number((1 - ok.length / samples.length).toFixed(4)),
    timeouts: samples.filter((sample) => sample.timedOut).length,
    "ttft p50 ms": percentile(firstTokens, 0.5),
    "ttft p95 ms": percentile(firstTokens, 0.95),
    "ttft p99 ms": percentile(firstTokens, 0.99),
    "total p50 ms": percentile(
      ok.map((sample) => sample.totalMs),
      0.5,
    ),
    "total p99 ms": percentile(
      ok.map((sample) => sample.totalMs),
      0.99,
    ),
    answeredBy: counts(ok.map((sample) => sample.model)),
  };
};

export const report = (
  { samples, cache }: LoadResult,
  bucketSeconds?: number,
) => {
  console.table({
    ...summarize(samples),
    statuses: counts(samples.map((sample) => sample.status)),
    "server cache": JSON.stringify(cache),
  });
  if (bucketSeconds === undefined) return;
  const buckets = Map.groupBy(samples, (sample) =>
    Math.floor(sample.sentAtMs / 1000 / bucketSeconds),
  );
  console.table(
    Object.fromEntries(
      [...buckets].map(([bucket, group]) => {
        const { requests, errorRate, timeouts, answeredBy, ...latency } =
          summarize(group);
        return [
          `${bucket * bucketSeconds}s`,
          {
            requests,
            errorRate,
            timeouts,
            "ttft p50 ms": latency["ttft p50 ms"],
            "ttft p95 ms": latency["ttft p95 ms"],
            answeredBy,
          },
        ];
      }),
    ),
  );
};
