import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createMockGitHub, type MockGitHubServer } from "@buncus/mock-github";
import { setConfig, resetConfig } from "../src/config.ts";
import { createContext, type Context } from "../src/context.ts";
import { handleApi } from "../src/routes/api.ts";

let mock: MockGitHubServer;
let ctx: Context;

const PUBLIC = "http://buncus.test";

beforeAll(() => {
  mock = createMockGitHub().listen(0);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  resetConfig();
  setConfig({
    publicUrl: PUBLIC,
    apiHost: mock.url,
    oauthHost: mock.url,
    appId: mock.store.appId,
    clientId: mock.store.clientId,
    clientSecret: mock.store.clientSecret,
    privateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    encryptionPassword: "test-password-test-password-test-password",
    dbPath: ":memory:",
    origins: ["http://site"],
    originsRegex: [],
  });
  ctx = createContext();
});

afterAll(() => mock.stop());

function api(method: string, path: string, opts: { session?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.session) headers["x-buncus-session"] = opts.session;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${PUBLIC}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return handleApi(req, new URL(req.url), ctx);
}

/** Drive the OAuth dance through buncus + the mock, returning the session. */
async function signIn(returnUrl = "http://site/page"): Promise<string> {
  const authorize = await api("GET", `/api/oauth/authorize?redirect_uri=${encodeURIComponent(returnUrl)}`);
  expect(authorize!.status).toBe(302);
  const ghAuthorizeUrl = new URL(authorize!.headers.get("location")!);
  expect(ghAuthorizeUrl.origin).toBe(mock.url);

  // The user approves at the mock.
  const ghRedirect = await mock.fetch(new Request(ghAuthorizeUrl.href));
  const back = new URL(ghRedirect.headers.get("location")!); // buncus callback... no:
  // mock redirects to buncus' callback (redirect_uri param) with code+state.
  const callback = await api("GET", `/api/oauth/authorized${back.search}`);
  expect(callback!.status).toBe(302);
  const final = new URL(callback!.headers.get("location")!);
  expect(final.origin + final.pathname).toBe(returnUrl);
  // C1: session is delivered in the fragment, not the query.
  expect(final.searchParams.get("buncus")).toBeNull();
  const session = new URLSearchParams(final.hash.replace(/^#/, "")).get("buncus");
  expect(session).toBeTruthy();
  return session!;
}

describe("buncus API (proxied) against mock GitHub", () => {
  test("OAuth dance yields a session that decodes to a user token", async () => {
    const session = await signIn();
    expect(session.length).toBeGreaterThan(20);
  });

  test("categories are listed with parsed emoji", async () => {
    const res = await api("GET", `/api/categories?repo=acme/docs`);
    const data = await res!.json();
    expect(data.repositoryId).toBeTruthy();
    expect(data.categories[0]).toMatchObject({ name: "General", emoji: "💬" });
  });

  test("full lifecycle: create → comment → reply → react → read back", async () => {
    const session = await signIn();
    const cats = await (await api("GET", `/api/categories?repo=acme/docs`))!.json();

    // Create the discussion for term "guide/start".
    const created = await (
      await api("POST", "/api/discussions", {
        session,
        body: {
          repo: "acme/docs",
          repositoryId: cats.repositoryId,
          categoryId: cats.categories[0].id,
          title: "guide/start",
          body: "Discussion for guide/start",
        },
      })
    )!.json();
    expect(created.id).toMatch(/^D_/);

    // Comment.
    const comment = await (
      await api("POST", "/api/comment", { session, body: { discussionId: created.id, body: "Great **page**!" } })
    )!.json();
    const commentId = comment.addDiscussionComment.comment.id;
    expect(commentId).toMatch(/^DC_/);

    // Reply.
    await api("POST", "/api/reply", { session, body: { discussionId: created.id, replyToId: commentId, body: "Agreed" } });

    // React (heart) on the comment.
    await api("POST", "/api/reaction", { session, body: { subjectId: commentId, content: "HEART", viewerHasReacted: false } });

    // Read back (signed in).
    const read = await (await api("GET", `/api/discussions?repo=acme/docs&term=guide/start&first=20`, { session }))!.json();
    expect(read.discussion.totalCommentCount).toBe(1);
    expect(read.discussion.comments[0].bodyHTML).toContain("<strong>page</strong>");
    expect(read.discussion.comments[0].replyCount).toBe(1);
    expect(read.discussion.comments[0].reactions.HEART.count).toBe(1);
    expect(read.discussion.comments[0].reactions.HEART.viewerHasReacted).toBe(true);
    expect(read.viewer.login).toBe("dev");
  });

  test("anonymous read (no session) uses the app token and finds the discussion", async () => {
    const read = await (await api("GET", `/api/discussions?repo=acme/docs&term=guide/start&first=20`))!.json();
    expect(read.discussion).toBeTruthy();
    expect(read.viewer.login).toBe("buncus[bot]");
  });

  test("missing discussion returns 404 with 'Discussion not found'", async () => {
    const res = await api("GET", `/api/discussions?repo=acme/docs&term=does/not/exist`);
    expect(res!.status).toBe(404);
    expect((await res!.json()).error).toBe("Discussion not found");
  });

  test("writes without a session are rejected", async () => {
    const res = await api("POST", "/api/comment", { body: { discussionId: "D_x", body: "hi" } });
    expect(res!.status).toBe(403);
  });
});
