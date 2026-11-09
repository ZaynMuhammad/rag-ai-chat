import { readFileSync, readdirSync } from "node:fs";

export const base = process.env["LOAD_BASE_URL"] ?? "http://localhost:3000";
export const ratePerSecond = Number(process.env["LOAD_RPS"] ?? "4");
export const durationSeconds = Number(process.env["LOAD_SECONDS"] ?? "60");
const metricsToken = process.env["LOAD_METRICS_TOKEN"];
const requestsPerSessionPerMinute = 8;

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

interface Sample {
  readonly status: number;
  readonly firstTokenMs: number | undefined;
  readonly totalMs: number;
  readonly failed: boolean;
}

const mintSession = async () => {
  const response = await fetch(`${base}/api/session`, { method: "POST" });
  if (!response.ok) throw new Error(`session ${response.status}`);
  return ((await response.json()) as { token: string }).token;
};

const ask = async (token: string, question: string): Promise<Sample> => {
  const start = performance.now();
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
  });
  if (!response.ok || response.body === null) {
    return {
      status: response.status,
      firstTokenMs: undefined,
      totalMs: performance.now() - start,
      failed: true,
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let firstTokenMs: number | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (firstTokenMs === undefined && text.includes('"_tag":"Delta"')) {
      firstTokenMs = performance.now() - start;
    }
  }
  return {
    status: response.status,
    firstTokenMs,
    totalMs: performance.now() - start,
    failed: text.includes('"_tag":"Failed"'),
  };
};

const percentile = (values: ReadonlyArray<number>, p: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return Math.round(
    sorted.at(Math.min(sorted.length - 1, Math.floor(p * sorted.length))) ?? 0,
  );
};

const cacheResults = async (): Promise<Record<string, number> | undefined> => {
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

const cacheHitRate = (
  before: Record<string, number> | undefined,
  after: Record<string, number> | undefined,
) => {
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

export const runChatLoad = async (
  scenario: string,
  questionAt: (index: number) => string,
) => {
  const total = Math.round(ratePerSecond * durationSeconds);
  const sessionCount = Math.ceil(
    (ratePerSecond * 60) / requestsPerSessionPerMinute,
  );
  const sessions = await Promise.all(
    Array.from({ length: sessionCount }, mintSession),
  );
  const questions = Array.from({ length: total }, (_, index) =>
    questionAt(index),
  );
  console.log(
    `${scenario}: ${total} chats at ${ratePerSecond}/s over ${durationSeconds}s, ${new Set(questions).size} distinct questions, ${sessionCount} sessions, ${base}`,
  );

  const before = await cacheResults();
  const pending: Array<Promise<Sample>> = [];
  const started = performance.now();
  for (const [index, question] of questions.entries()) {
    const due = started + (index * 1000) / ratePerSecond;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    pending.push(ask(sessions[index % sessions.length] ?? "", question));
  }
  const samples = await Promise.all(pending);
  const after = await cacheResults();

  const ok = samples.filter(
    (sample) => sample.status === 200 && !sample.failed,
  );
  const firstTokens = ok.flatMap((sample) =>
    sample.firstTokenMs === undefined ? [] : [sample.firstTokenMs],
  );
  const statuses = Object.fromEntries(
    [...Map.groupBy(samples, (sample) => sample.status)].map(
      ([status, group]) => [status, group.length],
    ),
  );
  console.table({
    requests: samples.length,
    errorRate: Number((1 - ok.length / samples.length).toFixed(4)),
    statuses: JSON.stringify(statuses),
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
    "server cache": JSON.stringify(cacheHitRate(before, after)),
  });
};
