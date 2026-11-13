const passedToOrigin = new Set([
  "accept",
  "accept-encoding",
  "authorization",
  "cache-control",
  "content-length",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "origin",
  "range",
  "rsc",
]);

const maxBodyBytes = 64 * 1024;

// eslint-disable-next-line no-restricted-syntax -- read only to tell the origin that a link-preview bot is asking; the value is never forwarded
const agentHeader = "user-agent";
const linkPreviewBots = /bot|facebookexternalhit|whatsapp|preview/i;
const linkPreviewMarker = "Twitterbot";

const isPassedToOrigin = (name) =>
  passedToOrigin.has(name) || name.startsWith("next-");

const originHeaders = (request, publicHost) => {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (isPassedToOrigin(name)) headers.append(name, value);
  }
  if (linkPreviewBots.test(request.headers.get(agentHeader) ?? "")) {
    headers.set(agentHeader, linkPreviewMarker);
  }
  headers.set("x-forwarded-host", publicHost);
  headers.set("x-forwarded-proto", "https");
  return headers;
};

const fromOrigin = (request, env, url, headers) =>
  env.ORIGIN.fetch(
    new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    }),
  );

const hasBody = (request) =>
  request.method !== "GET" && request.method !== "HEAD";

const bodyTooLarge = (request) => {
  const length = Number(request.headers.get("content-length") ?? "unknown");
  return !Number.isInteger(length) || length > maxBodyBytes;
};

const isImmutableAsset = (request, url) =>
  request.method === "GET" && url.pathname.startsWith("/_next/static/");

const immutableAsset = async (request, env, url, context) => {
  const cached = await caches.default.match(url.href);
  if (cached) return cached;
  const headers = originHeaders(request, url.host);
  headers.delete("accept-encoding");
  headers.delete("range");
  const response = await fromOrigin(request, env, url, headers);
  if (response.status === 200) {
    context.waitUntil(caches.default.put(url.href, response.clone()));
  }
  return response;
};

const worker = {
  fetch(request, env, context) {
    const url = new URL(request.url);
    if (hasBody(request) && bodyTooLarge(request)) {
      return new Response("Request body too large", { status: 413 });
    }
    if (isImmutableAsset(request, url)) {
      return immutableAsset(request, env, url, context);
    }
    return fromOrigin(request, env, url, originHeaders(request, url.host));
  },
};

export default worker;
