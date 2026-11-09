import type { InvalidSession, RateLimited } from "./AnonymousSessions";

export const refusal = (error: InvalidSession | RateLimited) =>
  error._tag === "RateLimited"
    ? Response.json(
        { message: "Too many requests. Try again shortly." },
        {
          status: 429,
          headers: { "retry-after": String(error.retryAfterSeconds) },
        },
      )
    : Response.json({ message: "Session expired" }, { status: 401 });
