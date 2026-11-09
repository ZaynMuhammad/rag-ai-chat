import { bearerToken } from "@/app/bearer";
import { serveChat } from "@/server/gateway/ChatGateway";
import { runtime } from "@/server/runtime";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => undefined);
  return runtime.runPromise(serveChat(bearerToken(request), body));
}
