// buncus' own JSON API. The widget (same-origin, inside the iframe) is the only
// caller. ALL GitHub traffic is proxied here server-side — the GitHub token
// never reaches browser JS (a deliberate, documented deviation from giscus).

import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig, isAllowedRedirect } from "../config.ts";
import { type Context, requireUserToken, resolveToken } from "../context.ts";
import { decodeState, encodeState } from "../crypto/state.ts";
import { adaptDiscussion } from "../github/adapters.ts";
import { getAppAccessToken } from "../github/appToken.ts";
import {
  addDiscussionComment,
  addDiscussionReply,
  createDiscussion,
  digestMessage,
  getDiscussion,
  getDiscussionCategories,
  type ReactionContent,
  toggleReaction,
} from "../github/graphql.ts";
import { checkToken, exchangeCodeForToken } from "../github/oauth.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

// owner/name with GitHub's allowed characters; rejects path/query injection (M5).
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const validRepo = (repo: string): boolean => REPO_RE.test(repo);

function adaptCategories(data: any) {
  const repo = data?.data?.search?.nodes?.[0];
  if (!repo) return { repositoryId: "", categories: [] };
  return {
    repositoryId: repo.id,
    categories: repo.discussionCategories.nodes.map(({ emojiHTML, ...rest }: any) => ({
      emoji: emojiHTML?.match(/">(.*?)<\/g-emoji/)?.[1] || "",
      ...rest,
    })),
  };
}

/** Read the adapted discussion (search or number mode). */
async function readDiscussion(req: Request, url: URL, ctx: Context): Promise<Response> {
  const q = url.searchParams;
  const repo = q.get("repo") ?? "";
  if (!validRepo(repo)) return json({ error: "Invalid `repo`." }, 400);
  const params = {
    repo,
    term: q.get("term") ?? "",
    number: Number(q.get("number") ?? 0),
    category: q.get("category") ?? "",
    strict: q.get("strict") === "true" || q.get("strict") === "1",
    first: q.get("first") ? Number(q.get("first")) : undefined,
    last: q.get("last") ? Number(q.get("last")) : undefined,
    after: q.get("after") ?? undefined,
    before: q.get("before") ?? undefined,
  };
  if (!params.first && !params.last) params.first = 20;

  let token: string, isUser: boolean;
  try {
    ({ token, isUser } = await resolveToken(req, repo, ctx));
  } catch (e) {
    return json({ error: (e as Error).message }, 403);
  }

  const response = await getDiscussion(params, token);
  if (response.message) {
    if (String(response.message).includes("Bad credentials")) return json({ error: response.message }, 403);
    return json({ error: response.message }, 500);
  }
  if (response.errors) {
    const msg = String(response.errors[0]?.message ?? "");
    if (msg.includes("Bad credentials")) return json({ error: "Bad credentials" }, 403);
    if (msg.includes("API rate limit exceeded")) {
      return json({ error: `API rate limit exceeded${isUser ? "" : ". Sign in to increase the rate limit"}` }, 429);
    }
    return json({ error: response.errors.map((e: any) => e.message).join(". ") }, 500);
  }

  const data = response.data;
  if (!data) return json({ error: "Unable to fetch discussion" }, 500);
  const discussion =
    "search" in data ? (data.search.discussionCount > 0 ? data.search.nodes[0] : null) : data.repository?.discussion;
  if (!discussion) return json({ error: "Discussion not found" }, 404);
  return json(adaptDiscussion(data.viewer, discussion));
}

/** Create a discussion (called lazily when a thread doesn't exist yet). */
async function postCreate(req: Request, ctx: Context): Promise<Response> {
  const body = await req.json();
  if (!validRepo(body?.repo ?? "")) return json({ error: "Invalid `repo`." }, 400);
  const userToken = await requireUserToken(req).catch(() => null);
  if (!userToken || !(await checkToken(userToken))) return json({ error: "Invalid or missing access token." }, 403);

  const marker = `<!-- sha1: ${await digestMessage(body.title)} -->`;
  const input = {
    repositoryId: body.repositoryId,
    categoryId: body.categoryId,
    title: body.title,
    body: `${body.body ?? ""}\n\n${marker}`,
  };
  // Discussions are authored by the app (giscus parity), even though a signed-in
  // user must authorise the request.
  let appToken: string;
  try {
    appToken = await getAppAccessToken(body.repo, ctx.cache);
  } catch (e) {
    return json({ error: (e as Error).message }, 403);
  }
  const res = await createDiscussion(input, appToken);
  const id = res?.data?.createDiscussion?.discussion?.id;
  if (!id) return json({ error: "Unable to create discussion." }, 400);
  return json({ id });
}

async function withUser(req: Request, fn: (token: string) => Promise<any>): Promise<Response> {
  let token: string;
  try {
    token = await requireUserToken(req);
  } catch {
    return json({ error: "Sign in required." }, 403);
  }
  const result = await fn(token);
  if (result?.errors) return json({ error: result.errors[0]?.message ?? "GitHub error" }, 403);
  return json(result.data);
}

/** Main API dispatch. Returns null if the path isn't an API route. */
export async function handleApi(req: Request, url: URL, ctx: Context): Promise<Response | null> {
  const p = url.pathname;
  const cfg = getConfig();

  // ---- OAuth ----------------------------------------------------------------
  if (p === "/api/oauth/authorize" && req.method === "GET") {
    const returnUrl = url.searchParams.get("redirect_uri");
    if (!returnUrl) return json({ error: "`redirect_uri` is required." }, 400);
    // C1: only redirect back to an allowlisted origin (or buncus itself).
    if (!isAllowedRedirect(returnUrl, cfg)) return json({ error: "`redirect_uri` is not allowed." }, 400);
    const state = await encodeState(returnUrl, cfg.encryptionPassword);
    const redirect = `${cfg.publicUrl}/api/oauth/authorized`;
    const params = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirect, state });
    return Response.redirect(`${cfg.oauthHost}/login/oauth/authorize?${params}`, 302);
  }

  if (p === "/api/oauth/authorized" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    const error = url.searchParams.get("error");
    let returnUrl: string;
    try {
      returnUrl = await decodeState(state, cfg.encryptionPassword);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    // C1: re-validate after decode (defence in depth) — never redirect off-allowlist.
    if (!isAllowedRedirect(returnUrl, cfg)) return json({ error: "`redirect_uri` is not allowed." }, 400);
    const ret = new URL(returnUrl);
    if (error === "access_denied") return Response.redirect(ret.href, 302);
    if (!code) return json({ error: "`code` and `state` are required." }, 400);
    let userToken: string;
    try {
      userToken = await exchangeCodeForToken(code, state);
    } catch (e) {
      return json({ error: (e as Error).message }, 503);
    }
    const session = await encodeState(userToken, cfg.encryptionPassword, Date.now() + cfg.sessionTtlMs);
    // C1: deliver the session in the URL fragment, not the query — fragments are
    // not sent in Referer or to servers (no access-log leak). The loader reads it
    // from location.hash and immediately scrubs it.
    ret.hash = `buncus=${encodeURIComponent(session)}`;
    return Response.redirect(ret.href, 302);
  }

  // ---- Reads ----------------------------------------------------------------
  if (p === "/api/discussions" && req.method === "GET") return readDiscussion(req, url, ctx);
  if (p === "/api/categories" && req.method === "GET") {
    const repo = url.searchParams.get("repo") ?? "";
    if (!validRepo(repo)) return json({ error: "Invalid `repo`." }, 400);
    let token: string;
    try {
      ({ token } = await resolveToken(req, repo, ctx));
    } catch (e) {
      return json({ error: (e as Error).message }, 403);
    }
    return json(adaptCategories(await getDiscussionCategories(repo, token)));
  }

  // ---- Writes (all require a signed-in user) --------------------------------
  if (p === "/api/discussions" && req.method === "POST") return postCreate(req, ctx);
  if (p === "/api/comment" && req.method === "POST") {
    const b = await req.json();
    return withUser(req, (t) => addDiscussionComment(b.body, b.discussionId, t));
  }
  if (p === "/api/reply" && req.method === "POST") {
    const b = await req.json();
    return withUser(req, (t) => addDiscussionReply(b.body, b.discussionId, b.replyToId, t));
  }
  if (p === "/api/reaction" && req.method === "POST") {
    const b = await req.json();
    return withUser(req, (t) => toggleReaction(b.content as ReactionContent, b.subjectId, !!b.viewerHasReacted, t));
  }

  if (p === "/api/webhook" && req.method === "POST") {
    // Stub today, but verify the HMAC signature when a secret is configured so
    // it can't be spoofed if it ever grows side effects (security-report L).
    if (cfg.webhookSecret) {
      const sig = req.headers.get("x-hub-signature-256") ?? "";
      const raw = await req.text();
      const expected = `sha256=${createHmac("sha256", cfg.webhookSecret).update(raw).digest("hex")}`;
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return json({ error: "Invalid signature." }, 401);
    }
    return json({ success: true });
  }

  return null;
}
