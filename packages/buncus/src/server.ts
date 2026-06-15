#!/usr/bin/env bun
// buncus — single-binary host for themeable GitHub Discussions comments.
//
//   bun run src/server.ts          (dev; run `bun run build:assets` first)
//   bun run compile && ./dist/buncus
//
// Serves: the embed loader (/buncus.js), the iframe widget (/{lang?}/widget),
// the parent + widget CSS and themes, and the proxied JSON API (/api/*).

import { getConfig, isAllowedOrigin } from "./config.ts";
import { createContext } from "./context.ts";
import { handleApi } from "./routes/api.ts";
import { serveAsset } from "./routes/assets.ts";
import { renderWidget } from "./routes/widget.ts";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

function withSecurity(res: Response): Response {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!res.headers.has(k)) res.headers.set(k, v);
  }
  return res;
}

const RL_WINDOW_MS = 60_000;
const RL_MAX = 120; // requests per IP per window on /api/*

function clientIp(req: Request, server: any): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim();
  try {
    return server?.requestIP?.(req)?.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function createServer() {
  const ctx = createContext();
  const rl = new Map<string, { count: number; reset: number }>(); // per-server (M5)

  function rateOk(ip: string): boolean {
    const now = Date.now();
    let e = rl.get(ip);
    if (!e || now > e.reset) {
      e = { count: 0, reset: now + RL_WINDOW_MS };
      rl.set(ip, e);
    }
    e.count += 1;
    if (rl.size > 10_000) for (const [k, v] of rl) if (now > v.reset) rl.delete(k);
    return e.count <= RL_MAX;
  }

  const handler = async (req: Request, server?: any): Promise<Response> => {
    const cfg = getConfig(); // read per-request (memoised) so config changes apply
    const url = new URL(req.url);
    const path = url.pathname;

    // /{lang}/widget -> strip the locale segment (language is presentational here).
    if (/^\/(?:[a-zA-Z-]+\/)?widget$/.test(path)) return withSecurity(renderWidget(url));

    if (path === "/" || path === "/healthz") {
      return withSecurity(new Response("buncus ok\n", { headers: { "content-type": "text/plain" } }));
    }

    if (path.startsWith("/api/")) {
      const origin = req.headers.get("origin");
      // M6: enforce the allowlist on cross-origin API calls (same-origin omits or
      // matches Origin). The header-based session already makes writes CSRF-safe;
      // this closes the cross-origin read/abuse gap.
      if (origin && !isAllowedOrigin(origin, cfg)) {
        return withSecurity(
          new Response(JSON.stringify({ error: "Origin not allowed." }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      // M5: per-IP rate limit (skipped in mock/dev).
      if (!cfg.mock && !rateOk(clientIp(req, server))) {
        return withSecurity(
          new Response(JSON.stringify({ error: "Too many requests." }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "60" },
          }),
        );
      }
      const api = await handleApi(req, url, ctx);
      if (api) {
        if (origin && isAllowedOrigin(origin, cfg)) {
          api.headers.set("access-control-allow-origin", origin);
          api.headers.set("vary", "Origin");
        }
        return withSecurity(api);
      }
    }

    const asset = await serveAsset(path);
    if (asset) return withSecurity(asset);

    return withSecurity(new Response("Not found", { status: 404 }));
  };

  return { fetch: handler, port: getConfig().port, ctx };
}

// Only listen when run directly (not when imported by tests).
if (import.meta.main) {
  const app = createServer();
  const server = Bun.serve({ port: app.port, fetch: app.fetch });
  console.log(`buncus listening on http://localhost:${server.port}`);
}
