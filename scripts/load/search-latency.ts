import { readFileSync, readdirSync } from "node:fs";

const base = process.env["LOAD_BASE_URL"] ?? "http://localhost:3000";
const concurrency = Number(process.env["LOAD_CONCURRENCY"] ?? "1");
const rounds = Number(process.env["LOAD_ROUNDS"] ?? "2");

const evalDirectory = new URL("../../evals/games/", import.meta.url);
const questions = readdirSync(evalDirectory)
  .filter((file) => file.endsWith(".jsonl"))
  .flatMap((file) =>
    readFileSync(new URL(file, evalDirectory), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => (JSON.parse(line) as { question: string }).question),
  );

interface Sample {
  readonly status: number;
  readonly millis: number;
  readonly shown: boolean;
}

const searchOnce = async (question: string): Promise<Sample> => {
  const start = performance.now();
  const response = await fetch(
    `${base}/api/search?q=${encodeURIComponent(question)}`,
  );
  const body = response.ok
    ? ((await response.json()) as { assist: { show: boolean } })
    : undefined;
  return {
    status: response.status,
    millis: performance.now() - start,
    shown: body?.assist.show ?? false,
  };
};

const percentile = (values: ReadonlyArray<number>, p: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return Math.round(
    sorted.at(Math.min(sorted.length - 1, Math.floor(p * sorted.length))) ?? 0,
  );
};

const queue = Array.from({ length: rounds }, () => questions).flat();
const samples: Array<Sample> = [];
const worker = async () => {
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    samples.push(await searchOnce(next));
  }
};

console.log(
  `${queue.length} searches (${questions.length} eval questions x ${rounds}), concurrency ${concurrency}, ${base}`,
);
const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const seconds = (performance.now() - started) / 1000;

const ok = samples.filter((sample) => sample.status === 200);
const millis = ok.map((sample) => sample.millis);
console.table({
  requests: samples.length,
  errorRate: Number((1 - ok.length / samples.length).toFixed(4)),
  "throughput rps": Number((samples.length / seconds).toFixed(1)),
  "assist trigger rate": Number(
    (ok.filter((sample) => sample.shown).length / ok.length).toFixed(3),
  ),
  "p50 ms": percentile(millis, 0.5),
  "p95 ms": percentile(millis, 0.95),
  "p99 ms": percentile(millis, 0.99),
  "max ms": percentile(millis, 1),
});
