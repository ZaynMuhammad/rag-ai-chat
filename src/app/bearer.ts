export const bearerToken = (request: Request) =>
  request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
