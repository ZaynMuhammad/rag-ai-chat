import type { InvalidSession, RateLimited } from "./AnonymousSessions";
import type { NotEntitled } from "@/server/pro/Entitlements";
import type {
  InvalidBlindedMessage,
  InvalidCredential,
  StaleKey,
} from "@/server/pro/ProCredentials";

type Refused =
  | InvalidSession
  | RateLimited
  | NotEntitled
  | StaleKey
  | InvalidBlindedMessage
  | InvalidCredential;

const message = (text: string, status: number) =>
  Response.json({ message: text }, { status });

export const refusal = (error: Refused) => {
  switch (error._tag) {
    case "RateLimited":
      return Response.json(
        { message: "Too many requests. Try again shortly." },
        {
          status: 429,
          headers: { "retry-after": String(error.retryAfterSeconds) },
        },
      );
    case "InvalidSession":
      return message("Session expired", 401);
    case "NotEntitled":
      return message("Access code not recognised", 403);
    case "StaleKey":
      return message("Signing key changed. Fetch /api/pro/keys again.", 409);
    case "InvalidBlindedMessage":
      return message("Invalid blinded message", 400);
    case "InvalidCredential":
      return message("Credential rejected", 403);
  }
};
