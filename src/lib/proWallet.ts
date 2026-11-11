import { Option, Schema } from "effect";
import {
  Credential,
  IssueRequest,
  IssueResponse,
  maxBatchSize,
  PublishedKeys,
} from "@/server/pro/ProProtocol";
import { prepareBatch } from "./proCredentials";

export const walletChanged = "pro-credentials";

const Stored = Schema.fromJsonString(Schema.Array(Credential));
const decodeStored = Schema.decodeUnknownOption(Stored);
const encodeStored = Schema.encodeSync(Stored);
const decodeKeys = Schema.decodeUnknownSync(PublishedKeys);
const encodeIssueRequest = Schema.encodeSync(IssueRequest);
const decodeIssueResponse = Schema.decodeUnknownSync(IssueResponse);

const read = (): ReadonlyArray<Credential> => {
  try {
    return Option.getOrElse(
      decodeStored(localStorage.getItem(walletChanged) ?? "[]"),
      () => [],
    );
  } catch {
    return [];
  }
};

const write = (credentials: ReadonlyArray<Credential>) => {
  try {
    localStorage.setItem(walletChanged, encodeStored(credentials));
    window.dispatchEvent(new Event(walletChanged));
    return true;
  } catch {
    return false;
  }
};

export const storedCredentials = () => read().length;

export const nextCredential = () => read()[0];

export const dropCredential = (spent: Credential) =>
  write(read().filter(({ message }) => message !== spent.message));

const failure = async (response: Response) => {
  const body: unknown = await response.json().catch(() => undefined);
  return new Error(
    typeof body === "object" && body !== null && "message" in body
      ? String(body.message)
      : `HTTP ${response.status}`,
  );
};

export const fetchCredentials = async (
  code: string,
  cache: RequestCache = "default",
): Promise<number> => {
  const keysResponse = await fetch("/api/pro/keys", { cache });
  if (!keysResponse.ok) throw await failure(keysResponse);
  const [published] = decodeKeys(await keysResponse.json()).keys;
  if (published === undefined) throw new Error("No signing key published");
  const batch = await prepareBatch(published, maxBatchSize);
  const response = await fetch("/api/pro/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      encodeIssueRequest({
        code,
        keyId: published.id,
        blindedMessages: batch.blindedMessages,
      }),
    ),
  });
  if (response.status === 409 && cache !== "reload") {
    return fetchCredentials(code, "reload");
  }
  if (!response.ok) throw await failure(response);
  const issued = decodeIssueResponse(await response.json());
  const credentials = await batch.finalize(issued.blindSignatures);
  if (!write([...read(), ...credentials])) {
    throw new Error("This browser would not store the credentials");
  }
  return credentials.length;
};
