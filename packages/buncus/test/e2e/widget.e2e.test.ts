// End-to-end browser test (Playwright + bun:test). Drives a real headless
// Chromium through the full buncus stack:
//   demo host page -> consent gate -> widget iframe -> read seeded discussion
//   -> OAuth sign-in (auto-approved by the mock) -> post a comment.
// No GitHub access: everything runs against @buncus/mock-github.
//
// Skips cleanly if Chromium isn't installed (mirrors the repo's e2e convention).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createMockGitHub, type MockGitHubServer } from "@buncus/mock-github";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { renderDemoPage } from "../../demo/page.ts";
import { resetConfig, setConfig } from "../../src/config.ts";
import { createServer } from "../../src/server.ts";

const CHROMIUM_OK = existsSync(join(homedir(), ".cache", "ms-playwright"));
const d = CHROMIUM_OK ? describe : describe.skip;

let mock: MockGitHubServer;
let browser: Browser;
let buncusServer: ReturnType<typeof Bun.serve>;
let hostServer: ReturnType<typeof Bun.serve>;
let hostOrigin: string;
let repoId: string;
let categoryId: string;

d("buncus widget e2e (headless chromium)", () => {
  beforeAll(async () => {
    // 1. Mock GitHub, seeded with a discussion + comment + reaction.
    mock = createMockGitHub().listen(0);
    const repo = mock.store.getRepo("acme/docs")!;
    repoId = repo.id;
    categoryId = repo.categories[0].id;
    const disc = mock.store.createDiscussion({
      repositoryId: repo.id,
      categoryId,
      title: "guide/start",
      body: "seed\n\n<!-- sha1: seed -->",
    });
    const c = mock.store.addComment(disc.id, mock.store.viewerUserId, "Hello from **buncus**! Try the demo.");
    mock.store.toggleReaction(c.id, "HEART", mock.store.viewerUserId, true);

    // 2. buncus server (needs a real port; publicUrl patched after listen).
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    resetConfig();
    setConfig({
      publicUrl: "http://localhost:0",
      apiHost: mock.url,
      oauthHost: mock.url,
      appId: mock.store.appId,
      clientId: mock.store.clientId,
      clientSecret: mock.store.clientSecret,
      privateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
      encryptionPassword: "e2e-password-e2e-password-e2e-password",
      dbPath: ":memory:",
      origins: [],
      originsRegex: [],
    });
    const app = createServer();
    buncusServer = Bun.serve({ port: 0, fetch: app.fetch });
    const buncusOrigin = `http://localhost:${buncusServer.port}`;
    // Re-set with the real ports: publicUrl (OAuth callback) + the host origin
    // on the OAuth/framing allowlist (C1/M6).
    setConfig({ publicUrl: buncusOrigin });

    // 3. Host page server (embeds the loader; serves the page on every path so
    //    the OAuth ?buncus= return lands here too).
    hostServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const theme = new URL(req.url).searchParams.get("theme") ?? "light";
        const html = await renderDemoPage({ origin: buncusOrigin, repoId, categoryId, theme });
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      },
    });
    hostOrigin = `http://localhost:${hostServer.port}`;
    setConfig({ origins: [hostOrigin] }); // allow the demo host to OAuth-redirect + embed (C1/M6)

    // Use the full chromium build (channel: "chromium"); the headless-shell
    // segfaults in this sandbox while the full build runs fine.
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  });

  afterAll(async () => {
    await browser?.close();
    buncusServer?.stop(true);
    hostServer?.stop(true);
    mock?.stop();
  });

  async function fresh(): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext();
    return { ctx, page: await ctx.newPage() };
  }

  test("consent gate blocks loading until opt-in", async () => {
    const { ctx, page } = await fresh();
    try {
      await page.goto(hostOrigin);
      await page.locator(".buncus-consent").waitFor({ state: "visible" });
      // No iframe (and therefore no GitHub traffic) before consent.
      expect(await page.locator("iframe.buncus-frame").count()).toBe(0);
      expect(await page.locator(".buncus-consent__load").textContent()).toContain("Load comments");
    } finally {
      await ctx.close();
    }
  }, 30_000);

  test("after opt-in, the seeded discussion renders (anonymous)", async () => {
    const { ctx, page } = await fresh();
    try {
      await page.goto(hostOrigin);
      await page.locator(".buncus-consent__load").click();

      const frame = page.frameLocator("iframe.buncus-frame");
      await frame.locator(".bc-root").waitFor({ state: "visible" });

      // Seeded comment body (Markdown rendered to HTML).
      await frame.getByText("Hello from").waitFor({ state: "visible" });
      expect(await frame.locator(".bc-markdown").first().innerHTML()).toContain("<strong>buncus</strong>");

      // Header count + a reaction with count 1.
      await frame.getByText("1 comment", { exact: false }).waitFor();
      expect(await frame.locator(".bc-reaction__count").first().textContent()).toBe("1");

      // Not signed in yet → sign-in prompt.
      await frame.getByRole("button", { name: /sign in with github/i }).waitFor();
    } finally {
      await ctx.close();
    }
  }, 45_000);

  test("OAuth sign-in then posting a comment works end-to-end", async () => {
    const { ctx, page } = await fresh();
    try {
      await page.goto(hostOrigin);
      // Remember consent so the post-OAuth reload auto-loads the widget.
      await page.locator(".buncus-consent__remember input").check();
      await page.locator(".buncus-consent__load").click();

      let frame = page.frameLocator("iframe.buncus-frame");
      const signIn = frame.getByRole("button", { name: /sign in with github/i });
      await signIn.waitFor();

      // Sign in: navigates the top frame through buncus -> mock -> back. The
      // mock auto-approves; we wait for the widget to come back signed in.
      await signIn.click();
      await page.waitForLoadState("networkidle");

      frame = page.frameLocator("iframe.buncus-frame");
      const textarea = frame.locator("textarea.bc-textarea");
      await textarea.waitFor({ state: "visible", timeout: 20_000 });
      // Signed-in affordance.
      await frame.getByRole("button", { name: /sign out/i }).waitFor();

      // Post a comment.
      await textarea.fill("A comment posted by the e2e test.");
      await frame.getByRole("button", { name: /^comment$/i }).click();

      // It shows up in the thread and the count goes to 2.
      await frame.getByText("A comment posted by the e2e test.").waitFor({ state: "visible", timeout: 20_000 });
      await frame.getByText("2 comments", { exact: false }).waitFor();

      // And it's actually in the mock's store.
      const stored = [...mock.store.comments.values()].some((c) => c.body.includes("e2e test"));
      expect(stored).toBe(true);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  test("the dark theme is applied in the iframe", async () => {
    const { ctx, page } = await fresh();
    try {
      await page.goto(`${hostOrigin}/?theme=dark`);
      await page.locator(".buncus-consent__load").click();
      const frame = page.frameLocator("iframe.buncus-frame");
      await frame.locator(".bc-root").waitFor({ state: "visible" });
      // The dark theme link is loaded…
      expect(await frame.locator("#buncus-theme").getAttribute("href")).toBe("/themes/dark.css");
      // …and the dark token actually applies (widget body is transparent by
      // design; the themed colour shows on .bc-root text).
      const color = await frame.locator(".bc-root").evaluate((el) => getComputedStyle(el).color);
      expect(color).toBe("rgb(230, 237, 243)"); // --bc-fg dark (#e6edf3)
    } finally {
      await ctx.close();
    }
  }, 45_000);
});
