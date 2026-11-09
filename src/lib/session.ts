import { Schema } from "effect";
import {
  type IssuedSession,
  IssuedSession as IssuedSessionSchema,
} from "@/server/gateway/SessionProtocol";

const decodeSession = Schema.decodeUnknownSync(IssuedSessionSchema);
const renewBeforeExpiry = 60_000;

let current: IssuedSession | undefined;

const mint = async () => {
  const response = await fetch("/api/session", { method: "POST" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  current = decodeSession(await response.json());
  return current.token;
};

const sessionToken = async () =>
  current !== undefined && current.expiresAt - Date.now() > renewBeforeExpiry
    ? current.token
    : mint();

export const fetchWithSession = async (url: string, init: RequestInit) => {
  const send = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };
  const response = await send(await sessionToken());
  return response.status === 401 ? send(await mint()) : response;
};
