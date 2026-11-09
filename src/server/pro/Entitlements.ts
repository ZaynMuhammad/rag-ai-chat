import { createHash } from "node:crypto";
import { Config, Context, Effect, Layer, Schema } from "effect";

export class NotEntitled extends Schema.TaggedError<NotEntitled>()(
  "NotEntitled",
  {},
) {}

export interface Entitlement {
  readonly id: string;
}

const digest = (code: string) =>
  createHash("sha256").update(code).digest("base64url");

export class Entitlements extends Context.Service<
  Entitlements,
  { check(proof: string): Effect.Effect<Entitlement, NotEntitled> }
>()("rag-ai-chat/pro/Entitlements") {
  static readonly accessCodes = (codes: ReadonlyArray<string>) => {
    const accepted = new Set(codes.filter((code) => code !== "").map(digest));
    return Layer.succeed(
      Entitlements,
      Entitlements.of({
        check: Effect.fn("Entitlements.check")(function* (proof: string) {
          const id = digest(proof);
          if (!accepted.has(id)) return yield* new NotEntitled();
          return { id };
        }),
      }),
    );
  };

  static readonly layer = Layer.unwrap(
    Effect.map(
      Config.String("PRO_ACCESS_CODES").pipe(Config.withDefault("")),
      (codes) =>
        Entitlements.accessCodes(codes.split(",").map((code) => code.trim())),
    ),
  );
}
