import { Schema } from "effect";
import {
  type IssuedSession,
  IssuedSession as IssuedSessionSchema,
} from "@/server/gateway/SessionProtocol";
import { type Credential, SessionRequest } from "@/server/pro/ProProtocol";
import { dropCredential, nextCredential } from "./proWallet";

const decodeSession = Schema.decodeUnknownSync(IssuedSessionSchema);
const encodeSessionRequest = Schema.encodeSync(SessionRequest);
const renewBeforeExpiry = 60_000;

let current: IssuedSession | undefined;

const requestSession = (credential: Credential | undefined) =>
  fetch("/api/session", {
    method: "POST",
    ...(credential !== undefined && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(encodeSessionRequest({ credential })),
    }),
  });

const accept = async (response: Response) => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  current = decodeSession(await response.json());
  return current.token;
};

const mint = async (): Promise<string> => {
  const credential = nextCredential();
  if (credential === undefined) return accept(await requestSession(undefined));
  const response = await requestSession(credential);
  if (response.ok || response.status === 403) dropCredential(credential);
  return response.status === 403 ? mint() : accept(response);
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
