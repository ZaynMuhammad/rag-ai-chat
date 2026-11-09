import { Effect, Exit, Schema } from "effect";
import { refusal } from "@/server/gateway/responses";
import { ProCredentials } from "@/server/pro/ProCredentials";
import { IssueRequest, IssueResponse } from "@/server/pro/ProProtocol";
import { runtime } from "@/server/runtime";

const decodeIssueRequest = Schema.decodeUnknownExit(IssueRequest);
const encodeIssueResponse = Schema.encodeSync(IssueResponse);

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => undefined);
  const decoded = decodeIssueRequest(body);
  if (Exit.isFailure(decoded)) {
    return Response.json(
      { message: "Invalid issuance request" },
      { status: 400 },
    );
  }

  return runtime.runPromise(
    Effect.flatMap(ProCredentials, (credentials) =>
      credentials.issue(decoded.value),
    ).pipe(
      Effect.match({
        onFailure: refusal,
        onSuccess: (issued) =>
          Response.json(encodeIssueResponse(issued), {
            headers: { "cache-control": "no-store" },
          }),
      }),
    ),
  );
}
