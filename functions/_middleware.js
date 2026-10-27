// The site lives only on breadboardsimulator.com. Pages also serves every deployment on
// *.pages.dev addresses, so send those visitors to the real domain instead.
const HOME = "breadboardsimulator.com";

export function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (!url.hostname.endsWith(".pages.dev")) return next();
  url.protocol = "https:";
  url.hostname = HOME;
  url.port = "";
  // 302, not 301, so browsers don't remember the redirect if this ever changes.
  return Response.redirect(url.toString(), 302);
}
