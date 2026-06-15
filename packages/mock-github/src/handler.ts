// Top-level request router. Serves BOTH GitHub origins on one host:
//   - OAuth (normally github.com):       /login/oauth/{authorize,access_token}
//   - REST/GraphQL (api.github.com):     /graphql /markdown /repos/* /app/* /applications/*
// The path namespaces don't collide, so buncus can point both
// GITHUB_API_HOST and GITHUB_OAUTH_HOST at this single origin.

import { handleGraphQL } from "./graphql.ts";
import { accessToken, authorize } from "./oauth.ts";
import {
  checkToken,
  createInstallationToken,
  getContents,
  getRepoInstallation,
  postMarkdown,
  type Result,
} from "./rest.ts";
import type { Store } from "./store.ts";

function corsHeaders(origin: string | null): Record<string, string> {
  // api.github.com is CORS-enabled; mirror it so browser-side writes work in dev.
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, Accept, X-Requested-With",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function toResponse(r: Result, origin: string | null): Response {
  const headers = new Headers(corsHeaders(origin));
  if (r.location) {
    headers.set("location", r.location);
    return new Response(null, { status: r.status, headers });
  }
  if (r.text !== undefined) {
    headers.set("content-type", r.contentType ?? "text/plain; charset=utf-8");
    return new Response(r.text, { status: r.status, headers });
  }
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(r.json ?? null), { status: r.status, headers });
}

function bearer(req: Request): string | undefined {
  return req.headers.get("authorization")?.split("Bearer ")[1];
}

async function readBody(req: Request): Promise<any> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return req.json();
  if (ct.includes("application/x-www-form-urlencoded")) return new URLSearchParams(await req.text());
  // giscus posts the token exchange as URLSearchParams without an explicit CT in some paths.
  const text = await req.text();
  try {
    return JSON.parse(text);
  } catch {
    return new URLSearchParams(text);
  }
}

/**
 * Core dispatch. Returns a Response. Use this directly in unit tests
 * (no port needed) or behind Bun.serve for integration/binary runs.
 */
export async function handleRequest(store: Store, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ---- OAuth ----------------------------------------------------------------
  if (path === "/login/oauth/authorize" && req.method === "GET") {
    return toResponse(authorize(store, url), origin);
  }
  if (path === "/login/oauth/access_token" && req.method === "POST") {
    const body = await readBody(req);
    const params = body instanceof URLSearchParams ? body : new URLSearchParams(body);
    return toResponse(await accessToken(store, params), origin);
  }

  // ---- GraphQL --------------------------------------------------------------
  if (path === "/graphql" && req.method === "POST") {
    const body = await readBody(req);
    return toResponse(handleGraphQL(store, body, bearer(req)), origin);
  }

  // ---- Markdown -------------------------------------------------------------
  if (path === "/markdown" && req.method === "POST") {
    const body = await readBody(req);
    return toResponse(await postMarkdown(body), origin);
  }

  // ---- Check a token --------------------------------------------------------
  let m = path.match(/^\/applications\/([^/]+)\/token$/);
  if (m && req.method === "POST") {
    const auth = req.headers.get("authorization") ?? "";
    const decoded = auth.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString() : "";
    const clientId = decoded.split(":")[0] || decodeURIComponent(m[1]);
    const body = await readBody(req);
    const accessTokenValue = body?.access_token ?? "";
    return toResponse(checkToken(store, clientId, accessTokenValue), origin);
  }

  // ---- Repository installation ---------------------------------------------
  m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/installation$/);
  if (m && req.method === "GET") {
    return toResponse(getRepoInstallation(store, m[1], m[2]), origin);
  }

  // ---- Create installation access token ------------------------------------
  m = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
  if (m && req.method === "POST") {
    return toResponse(createInstallationToken(store, Number(m[1])), origin);
  }

  // ---- Repo contents (giscus.json) -----------------------------------------
  m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
  if (m && req.method === "GET") {
    return toResponse(getContents(store, m[1], m[2], decodeURIComponent(m[3])), origin);
  }

  return toResponse(
    { status: 404, json: { message: "Not Found", documentation_url: "https://docs.github.com/rest" } },
    origin,
  );
}
