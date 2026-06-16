// Regression tests for the security-report fixes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createMockGitHub, type MockGitHubServer } from "@liebstoeckel/buncus-mock-github";
import { type Config, isAllowedOrigin, setConfig } from "../src/config.ts";
import { createContext } from "../src/context.ts";
import { handleApi } from "../src/routes/api.ts";
import { createServer } from "../src/server.ts";
import { resolveThemeHref } from "../src/theme.ts";

let mock: MockGitHubServer;
let privateKey: string;
const PUBLIC = "http://buncus.test";

beforeAll(() => {
  mock = createMockGitHub().listen(0);
  privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs1", format: "pem" })
    .toString();
});
afterAll(() => mock.stop());

function configure(overrides: Partial<Config> = {}) {
  setConfig({
    publicUrl: PUBLIC,
    apiHost: mock.url,
    oauthHost: mock.url,
    appId: mock.store.appId,
    clientId: mock.store.clientId,
    clientSecret: mock.store.clientSecret,
    privateKey,
    encryptionPassword: "security-test-password-security-test",
    dbPath: ":memory:",
    origins: ["http://site"],
    originsRegex: [],
    mock: true,
    ...overrides,
  });
}

const apiReq = (method: string, path: string, headers: Record<string, string> = {}) =>
  handleApi(new Request(`${PUBLIC}${path}`, { method, headers }), new URL(`${PUBLIC}${path}`), createContext());

describe("C1 — OAuth redirect_uri allowlist", () => {
  test("rejects an off-allowlist redirect_uri (no open redirect)", async () => {
    configure();
    const res = await apiReq(
      "GET",
      `/api/oauth/authorize?redirect_uri=${encodeURIComponent("https://evil.example/catch")}`,
    );
    expect(res?.status).toBe(400);
  });

  test("allows an allowlisted redirect_uri", async () => {
    configure();
    const res = await apiReq("GET", `/api/oauth/authorize?redirect_uri=${encodeURIComponent("http://site/page")}`);
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")?.startsWith(mock.url)).toBe(true);
  });

  test("the callback delivers the session in the fragment, not the query", async () => {
    configure();
    const authorize = await apiReq(
      "GET",
      `/api/oauth/authorize?redirect_uri=${encodeURIComponent("http://site/page")}`,
    );
    const ghAuth = new URL(authorize!.headers.get("location")!);
    const back = new URL((await mock.fetch(new Request(ghAuth.href))).headers.get("location")!);
    const cb = await apiReq("GET", `/api/oauth/authorized${back.search}`);
    const final = new URL(cb!.headers.get("location")!);
    expect(final.searchParams.get("buncus")).toBeNull();
    expect(new URLSearchParams(final.hash.replace(/^#/, "")).get("buncus")).toBeTruthy();
  });
});

describe("ORIGINS_REGEX is anchored (no substring/suffix spoofing)", () => {
  // A natural, intended-exact pattern. It must not allow attacker suffixes.
  const cfg = {
    publicUrl: PUBLIC,
    origins: [],
    originsRegex: ["https://app\\.example\\.com"],
  } as unknown as Config;

  test("matches the exact origin", () => {
    expect(isAllowedOrigin("https://app.example.com", cfg)).toBe(true);
  });
  test("rejects an origin that merely contains the pattern (suffix spoof)", () => {
    expect(isAllowedOrigin("https://app.example.com.attacker.tld", cfg)).toBe(false);
  });
});

describe("M5 — repo validation", () => {
  test("rejects a malformed repo on reads", async () => {
    configure();
    const res = await apiReq(
      "GET",
      `/api/discussions?repo=${encodeURIComponent('evil" in:title x repo:other/secret')}&term=t`,
    );
    expect(res?.status).toBe(400);
  });
  test("rejects a malformed repo on categories", async () => {
    configure();
    expect((await apiReq("GET", `/api/categories?repo=not-a-repo`))?.status).toBe(400);
  });
});

describe("M6 — API origin enforcement", () => {
  test("a disallowed cross-origin request is 403", async () => {
    configure();
    const app = createServer();
    const res = await app.fetch(
      new Request(`${PUBLIC}/api/categories?repo=acme/docs`, { headers: { origin: "http://evil.example" } }),
    );
    expect(res.status).toBe(403);
  });
  test("an allowlisted origin passes and is reflected", async () => {
    configure();
    const app = createServer();
    const res = await app.fetch(
      new Request(`${PUBLIC}/api/categories?repo=acme/docs`, { headers: { origin: "http://site" } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://site");
  });
});

describe("M5 — rate limiting (non-mock)", () => {
  test("returns 429 once the per-IP limit is exceeded", async () => {
    configure({ mock: false });
    const app = createServer();
    let got429 = false;
    for (let i = 0; i < 130; i++) {
      const res = await app.fetch(new Request(`${PUBLIC}/api/webhook`, { method: "POST", body: "{}" }));
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });
});

describe("M4 — widget CSP + theme allowlist", () => {
  test("widget response carries a tight CSP", async () => {
    configure();
    const app = createServer();
    const res = await app.fetch(new Request(`${PUBLIC}/widget?theme=dark&origin=http://site/p`));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'self' http://site");
  });

  test("an un-allowlisted external theme URL falls back to a built-in", async () => {
    configure();
    const app = createServer();
    const res = await app.fetch(
      new Request(`${PUBLIC}/widget?theme=${encodeURIComponent("https://evil.example/x.css")}`),
    );
    const html = await res.text();
    expect(html).toContain("/themes/preferred_color_scheme.css");
    expect(html).not.toContain("evil.example");
  });

  test("an allowlisted external theme URL is applied, with crossorigin", async () => {
    configure({ themeOrigins: ["https://cdn.example"] });
    const app = createServer();
    const res = await app.fetch(
      new Request(`${PUBLIC}/widget?theme=${encodeURIComponent("https://cdn.example/brand.css")}`),
    );
    const html = await res.text();
    expect(html).toContain('href="https://cdn.example/brand.css"');
    expect(html).toContain('crossorigin="anonymous"');
    expect(res.headers.get("content-security-policy")).toContain("style-src 'self' https://cdn.example");
  });

  test("the theme link exposes the allowlist to the client via data-theme-origins", async () => {
    configure({ themeOrigins: ["https://cdn.example"] });
    const app = createServer();
    const res = await app.fetch(new Request(`${PUBLIC}/widget?theme=dark`));
    const html = await res.text();
    // JSON array, HTML-escaped (" -> &quot;), so the runtime swap can read the same gate.
    expect(html).toContain(`data-theme-origins="${'["https://cdn.example"]'.replace(/"/g, "&quot;")}"`);
  });
});

// Load-time and runtime both gate external themes through this one helper (M4),
// so the two paths can't drift. The runtime side (App.tsx) reads the same
// allowlist from `data-theme-origins`; here we exercise the shared resolver.
describe("M4 — resolveThemeHref (shared load-time + runtime gate)", () => {
  const allow = ["https://cdn.example"];

  test("built-in names resolve to the bundled stylesheet", () => {
    expect(resolveThemeHref("dark", [])).toBe("/themes/dark.css");
    expect(resolveThemeHref("preferred_color_scheme", [])).toBe("/themes/preferred_color_scheme.css");
  });

  test("same-origin paths pass through; protocol-relative is rejected", () => {
    expect(resolveThemeHref("/themes/custom.css", [])).toBe("/themes/custom.css");
    expect(resolveThemeHref("//evil.example/x.css", [])).toBeNull();
  });

  test("an external URL is accepted only when its origin is allowlisted", () => {
    expect(resolveThemeHref("https://cdn.example/brand.css", allow)).toBe("https://cdn.example/brand.css");
    expect(resolveThemeHref("https://evil.example/x.css", allow)).toBeNull();
    expect(resolveThemeHref("https://cdn.example/brand.css", [])).toBeNull();
  });

  test("unknown / malformed values are rejected (caller keeps the current theme)", () => {
    expect(resolveThemeHref("not-a-theme", allow)).toBeNull();
    expect(resolveThemeHref("https://", allow)).toBeNull();
  });
});
