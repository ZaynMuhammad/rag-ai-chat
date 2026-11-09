import type { Effect, ManagedRuntime } from "effect";
import { connection } from "next/server";
import { runtime } from "@/server/runtime";

export const runAtRequestTime = async <A, E>(
  effect: Effect.Effect<
    A,
    E,
    ManagedRuntime.ManagedRuntime.Services<typeof runtime>
  >,
) => {
  await connection();
  return runtime.runPromise(effect);
};
