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

const isPassedToOrigin = (name) =>
  passedToOrigin.has(name) || name.startsWith("next-");

const originHeaders = (request, publicHost) => {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (isPassedToOrigin(name)) headers.append(name, value);
  }
  headers.set("x-forwarded-host", publicHost);
  headers.set("x-forwarded-proto", "https");
  return headers;
};

const worker = {
  fetch(request, env) {
    const url = new URL(request.url);
    return env.ORIGIN.fetch(
      new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
        method: request.method,
        headers: originHeaders(request, url.host),
        body: request.body,
        redirect: "manual",
      }),
    );
  },
};

export default worker;
