import app from "./index";

// Old hostnames from before the フリマハーネス rename. Requests to them get a
// permanent redirect to the new hostname with path and query preserved.
// Remove this map (and the old staging route in wrangler.jsonc) once nothing
// uses the old URLs anymore.
export const legacyHosts: Record<string, string> = {
  "mer-harness-stg.sat0xshi.com": "furima-harness-stg.sat0xshi.com",
  "mer-harness.sat0xshi.com": "furima-harness.sat0xshi.com",
};

export function legacyRedirect(request: Request): Response | undefined {
  const url = new URL(request.url);
  const target = legacyHosts[url.hostname];
  if (!target) return undefined;
  url.hostname = target;
  url.protocol = "https:";
  url.port = "";
  return new Response(null, {
    status: 301,
    headers: { Location: url.toString(), "Cache-Control": "no-store" },
  });
}

export default {
  fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    return legacyRedirect(request) ?? app.fetch(request, env as never, ctx);
  },
};
