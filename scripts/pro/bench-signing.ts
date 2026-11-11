import { createPublicKey, generateKeyPairSync } from "node:crypto";
import {
  blind,
  bytesToInt,
  finalize,
  fromBase64Url,
  importPublicKey,
  intToBytes,
  modPow,
  randomMessage,
  verify,
} from "@/lib/blindRsa";
import { blindSign } from "@/server/pro/blindSign";

const runs = Number(process.env["BENCH_RUNS"] ?? "500");

const measure = async (count: number, run: () => unknown) => {
  const samples: Array<number> = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (p: number) =>
    (samples[Math.floor(p * (samples.length - 1))] ?? 0).toFixed(3);
  return `p50 ${at(0.5)} ms  p99 ${at(0.99)} ms  (${count} runs)`;
};

console.log(`node ${process.version}`);
for (const modulusLength of [2048, 4096]) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength });
  const spki = new Uint8Array(
    createPublicKey(privateKey).export({ type: "spki", format: "der" }),
  );
  const publicKey = await importPublicKey(spki);
  const message = randomMessage();
  const { blindedMessage, inverse } = await blind(publicKey, message);
  const blindSignature = blindSign(privateKey, blindedMessage);
  const signature = await finalize(publicKey, message, blindSignature, inverse);
  const privateExponent = bytesToInt(
    fromBase64Url(privateKey.export({ format: "jwk" }).d ?? ""),
  );
  const cases: ReadonlyArray<readonly [string, number, () => unknown]> = [
    [
      "server blind sign, node:crypto raw RSA",
      runs,
      () => blindSign(privateKey, blindedMessage),
    ],
    [
      "server blind sign, BigInt modPow",
      Math.ceil(runs / 50),
      () =>
        intToBytes(
          modPow(bytesToInt(blindedMessage), privateExponent, publicKey.n),
          publicKey.modulusLength,
        ),
    ],
    [
      "server verify at redemption",
      runs,
      () => verify(publicKey, message, signature),
    ],
    ["client blind", runs, () => blind(publicKey, randomMessage())],
    [
      "client finalize",
      runs,
      () => finalize(publicKey, message, blindSignature, inverse),
    ],
  ];
  console.log(`RSA-${modulusLength}`);
  for (const [name, count, run] of cases) {
    console.log(`  ${name.padEnd(40)} ${await measure(count, run)}`);
  }
}
