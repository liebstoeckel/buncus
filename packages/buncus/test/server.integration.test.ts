import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createMockGitHub, type MockGitHubServer } from "@liebstoeckel/buncus-mock-github";
import { resetConfig, setConfig } from "../src/config.ts";
import { createServer } from "../src/server.ts";

let mock: MockGitHubServer;
let app: ReturnType<typeof createServer>;
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
    encryptionPassword: "server-test-password-server-test-password",
    dbPath: ":memory:",
    origins: ["http://site"],
    originsRegex: [],
  });
  app = createServer();
});

afterAll(() => mock.stop());

const get = (path: string, headers?: Record<string, string>) => app.fetch(new Request(`${PUBLIC}${path}`, { headers }));

describe("static assets + widget shell", () => {
  test("/buncus.js serves the loader", async () => {
    const res = await get("/buncus.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toContain("buncus");
  });

  test("/default.css and themes serve CSS", async () => {
    for (const p of [
      "/default.css",
      "/widget.css",
      "/themes/light.css",
      "/themes/dark.css",
      "/themes/preferred_color_scheme.css",
    ]) {
      const res = await get(p);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/css");
    }
  });

  test("/widget renders the shell with the chosen theme + CSP + security headers", async () => {
    const res = await get("/widget?theme=dark&repo=acme/docs&origin=http://site/p");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="buncus-root"');
    expect(html).toContain('href="/themes/dark.css"');
    expect(html).toContain('src="/widget.js"');
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("/de/widget (localised path) also renders", async () => {
    const res = await get("/de/widget?theme=light");
    expect(res.status).toBe(200);
  });

  test("locale path sets <html lang> + localized loading shell", async () => {
    const html = await (await get("/ja/widget")).text();
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain("コメントを取得中…"); // ja loadingComments, not the English flash
  });

  test("RTL locale path adds dir=rtl", async () => {
    const html = await (await get("/ar/widget")).text();
    expect(html).toContain('<html lang="ar" dir="rtl">');
  });

  test("no locale path leaves <html> bare and English", async () => {
    const html = await (await get("/widget")).text();
    expect(html).toContain("<html>");
    expect(html).toContain("Loading comments…");
  });

  test("unknown built-in theme falls back to preferred_color_scheme", async () => {
    const html = await (await get("/widget?theme=bogus")).text();
    expect(html).toContain("/themes/preferred_color_scheme.css");
  });

  test("/healthz is ok", async () => {
    expect((await get("/healthz")).status).toBe(200);
  });
});

describe("API routed through the server", () => {
  test("categories load through /api", async () => {
    const data = await (await get("/api/categories?repo=acme/docs")).json();
    expect(data.categories[0].name).toBe("General");
  });

  test("anonymous discussion read for a fresh term is 404", async () => {
    const res = await get("/api/discussions?repo=acme/docs&term=brand/new");
    expect(res.status).toBe(404);
  });

  test("OAuth authorize redirects to the (mock) GitHub host", async () => {
    const res = await get(`/api/oauth/authorize?redirect_uri=${encodeURIComponent("http://site/p")}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")?.startsWith(mock.url)).toBe(true);
  });
});
