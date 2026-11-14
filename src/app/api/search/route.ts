import type { NextRequest } from "next/server";
import { serveSearch } from "@/server/gateway/SearchGateway";
import { runtime } from "@/server/runtime";

export async function GET(request: NextRequest) {
  return runtime.runPromise(serveSearch(request.nextUrl.searchParams.get("q")));
}
