import { describe, test, expect, beforeEach } from "bun:test";
import { createMockGitHub, resetIds, type MockGitHub } from "../src/index.ts";

const BASE = "http://gh";
let mock: MockGitHub;

beforeEach(() => {
  resetIds();
  mock = createMockGitHub();
});

function req(path: string, init?: RequestInit) {
  return mock.fetch(new Request(`${BASE}${path}`, init));
}

describe("OAuth web flow", () => {
  test("authorize auto-approves and redirects with code + state", async () => {
    const res = await req(
      `/login/oauth/authorize?client_id=${mock.store.clientId}&redirect_uri=http%3A%2F%2Fsite%2Fcb&state=xyz`,
    );
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("http://site/cb");
    expect(loc.searchParams.get("state")).toBe("xyz");
    expect(loc.searchParams.get("code")).toBeTruthy();
  });

  test("mock_error=access_denied redirects with error", async () => {
    const res = await req(
      `/login/oauth/authorize?client_id=${mock.store.clientId}&redirect_uri=http%3A%2F%2Fsite%2Fcb&state=s&mock_error=access_denied`,
    );
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  });

  test("code exchanges for an access token, single use", async () => {
    const auth = await req(
      `/login/oauth/authorize?client_id=${mock.store.clientId}&redirect_uri=http%3A%2F%2Fsite%2Fcb&state=s`,
    );
    const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;

    const body = new URLSearchParams({
      client_id: mock.store.clientId,
      client_secret: mock.store.clientSecret,
      code,
    });
    const res = await req(`/login/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    });
    const data = await res.json();
    expect(data.token_type).toBe("bearer");
    expect(data.access_token).toMatch(/^gho_/);
    // The minted token resolves to the seeded dev user.
    expect(mock.store.userForToken(data.access_token)?.login).toBe("dev");

    // Reusing the code fails.
    const reuse = await req(`/login/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect((await reuse.json()).error).toBe("bad_verification_code");
  });

  test("mock_user=<login> authenticates as that user (multi-user e2e)", async () => {
    mock.store.addUser({ login: "alice", avatarUrl: "https://avatars.githubusercontent.com/u/11?v=4", url: "https://github.com/alice" });

    const auth = await req(
      `/login/oauth/authorize?client_id=${mock.store.clientId}&redirect_uri=http%3A%2F%2Fsite%2Fcb&state=s&mock_user=alice`,
    );
    const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
    const res = await req(`/login/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ client_id: mock.store.clientId, client_secret: mock.store.clientSecret, code }),
    });
    const token = (await res.json()).access_token;
    // The token resolves to alice, not the default viewer (dev).
    expect(mock.store.userForToken(token)?.login).toBe("alice");
  });

  test("mock_user with an unknown login is rejected", async () => {
    const res = await req(
      `/login/oauth/authorize?client_id=${mock.store.clientId}&redirect_uri=http%3A%2F%2Fsite%2Fcb&mock_user=nobody`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_mock_user");
  });

  test("wrong client_secret returns incorrect_client_credentials", async () => {
    const res = await req(`/login/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: mock.store.clientId, client_secret: "nope", code: "x" }),
    });
    expect((await res.json()).error).toBe("incorrect_client_credentials");
  });
});

describe("REST: app installation + token", () => {
  test("get repo installation returns the installation id", async () => {
    const res = await req(`/repos/acme/docs/installation`, {
      headers: { authorization: "Bearer fake.jwt.token" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(42);
  });

  test("unknown repo installation is 404", async () => {
    const res = await req(`/repos/no/such/installation`);
    expect(res.status).toBe(404);
  });

  test("create installation access token mints a ghs_ token", async () => {
    const res = await req(`/app/installations/42/access_tokens`, {
      method: "POST",
      headers: { authorization: "Bearer fake.jwt.token" },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.token).toMatch(/^ghs_/);
    expect(data.expires_at).toBeTruthy();
    expect(data.permissions).toMatchObject({ discussions: "write", metadata: "read" });
  });
});

describe("REST: check a token", () => {
  test("valid user token returns app.client_id and user", async () => {
    // Mint a user token via the store directly.
    const code = mock.store.issueOAuthCode();
    const token = (mock.store.exchangeCode(code) as { access_token: string }).access_token;

    const basic = Buffer.from(`${mock.store.clientId}:${mock.store.clientSecret}`).toString("base64");
    const res = await req(`/applications/${encodeURIComponent(mock.store.clientId)}/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, accept: "application/vnd.github+json" },
      body: JSON.stringify({ access_token: token }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.app.client_id).toBe(mock.store.clientId);
    expect(data.user.login).toBe("dev");
  });

  test("unknown token is rejected (422)", async () => {
    const basic = Buffer.from(`${mock.store.clientId}:${mock.store.clientSecret}`).toString("base64");
    const res = await req(`/applications/${encodeURIComponent(mock.store.clientId)}/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}` },
      body: JSON.stringify({ access_token: "gho_nonexistent" }),
    });
    expect(res.status).toBe(422);
  });
});

describe("REST: contents + markdown", () => {
  test("giscus.json is returned base64-encoded and decodes to the repo config", async () => {
    const res = await req(`/repos/acme/docs/contents/giscus.json`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.encoding).toBe("base64");
    // Mirror giscus' getFile: Buffer.from(content, "base64").toString()
    const decoded = JSON.parse(Buffer.from(data.content, "base64").toString());
    expect(decoded.defaultCommentOrder).toBe("oldest");
  });

  test("markdown renders to HTML", async () => {
    const res = await req(`/markdown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "gfm", text: "Hello **world** and `code`" }),
    });
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<code>code</code>");
  });
});
