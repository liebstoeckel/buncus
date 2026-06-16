// End-to-end browser test (Playwright + bun:test). Drives a real headless
// Chromium through the full buncus stack:
//   demo host page -> consent gate -> widget iframe -> read seeded discussion
//   -> OAuth sign-in (auto-approved by the mock) -> post a comment.
// No GitHub access: everything runs against @liebstoeckel/buncus-mock-github.
//
// Skips cleanly if Chromium isn't installed (mirrors the repo's e2e convention).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createMockGitHub, type MockGitHubServer } from "@liebstoeckel/buncus-mock-github";
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
let buncusOrigin: string;
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
    buncusOrigin = `http://localhost:${buncusServer.port}`;
    // Re-set with the real ports: publicUrl (OAuth callback) + the host origin
    // on the OAuth/framing allowlist (C1/M6). Allowlist buncus' own origin as a
    // theme origin so the runtime-swap test can target an external-URL form
    // (buncus serves /themes/dark.css there) through the THEME_ORIGINS gate.
    setConfig({ publicUrl: buncusOrigin, themeOrigins: [buncusOrigin] });

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

  test("front/back pagination: 'load more' reveals the hidden middle", async () => {
    // Seed the thread past two pages (PAGE_SIZE 15 + 15) so a gap appears.
    // Done here, last, so the earlier exact-count assertions stay valid.
    const disc = [...mock.store.discussions.values()].find((x) => x.title === "guide/start")!;
    const existing = mock.store.topLevelComments(disc.id).length;
    for (let i = existing; i < 40; i++) {
      mock.store.addComment(disc.id, mock.store.viewerUserId, `seeded comment ${i}`);
    }

    const { ctx, page } = await fresh();
    try {
      await page.goto(hostOrigin);
      await page.locator(".buncus-consent__load").click();
      const frame = page.frameLocator("iframe.buncus-frame");
      await frame.locator(".bc-root").waitFor({ state: "visible" });
      await frame.getByText("40 comments", { exact: false }).waitFor();

      // Front 15 + back 15 are shown; the middle 10 are hidden behind the button.
      const loadMore = frame.locator(".bc-pagination");
      await loadMore.waitFor({ state: "visible" });
      expect(await loadMore.textContent()).toContain("10 hidden items");
      expect(await frame.locator(".bc-comment").count()).toBe(30);

      // Expanding one more front page closes the gap: all 40 render, button gone.
      await loadMore.click();
      await frame.locator(".bc-pagination").waitFor({ state: "detached" });
      expect(await frame.locator(".bc-comment").count()).toBe(40);
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

  // Post { buncus: { setConfig: { theme } } } from the host page to the iframe,
  // exactly as a parent page following its own light/dark toggle would.
  async function postTheme(page: Page, theme: string) {
    await page.evaluate(
      ({ theme, target }) => {
        const iframe = document.querySelector("iframe.buncus-frame") as HTMLIFrameElement;
        iframe.contentWindow!.postMessage({ buncus: { setConfig: { theme } } }, target);
      },
      { theme, target: buncusOrigin },
    );
  }

  async function themeHref(frame: ReturnType<Page["frameLocator"]>): Promise<string | null> {
    return frame.locator("#buncus-theme").getAttribute("href");
  }

  async function waitForThemeHref(frame: ReturnType<Page["frameLocator"]>, expected: string) {
    for (let i = 0; i < 50; i++) {
      if ((await themeHref(frame)) === expected) return;
      await Bun.sleep(100);
    }
    expect(await themeHref(frame)).toBe(expected); // fail with a useful diff
  }

  test("runtime theme swap: a built-in name re-themes live", async () => {
    const { ctx, page } = await fresh();
    try {
      await page.goto(`${hostOrigin}/?theme=light`);
      await page.locator(".buncus-consent__load").click();
      const frame = page.frameLocator("iframe.buncus-frame");
      await frame.locator(".bc-root").waitFor({ state: "visible" });
      expect(await themeHref(frame)).toBe("/themes/light.css");

      await postTheme(page, "dark");
      await waitForThemeHref(frame, "/themes/dark.css");
      const color = await frame.locator(".bc-root").evaluate((el) => getComputedStyle(el).color);
      expect(color).toBe("rgb(230, 237, 243)"); // dark --bc-fg actually applied
    } finally {
      await ctx.close();
    }
  }, 45_000);

  test("runtime theme swap: an allowlisted external URL is applied; a non-allowlisted one is ignored", async () => {
    const { ctx, page } = await fresh();
    try {
      await page.goto(`${hostOrigin}/?theme=light`);
      await page.locator(".buncus-consent__load").click();
      const frame = page.frameLocator("iframe.buncus-frame");
      await frame.locator(".bc-root").waitFor({ state: "visible" });
      expect(await themeHref(frame)).toBe("/themes/light.css");

      // Off-allowlist external URL: ignored, theme unchanged (fail-closed).
      await postTheme(page, "https://evil.example/x.css");
      await Bun.sleep(300);
      expect(await themeHref(frame)).toBe("/themes/light.css");

      // External URL whose origin IS in THEME_ORIGINS (buncusOrigin): applied.
      const allowed = `${buncusOrigin}/themes/dark.css`;
      await postTheme(page, allowed);
      await waitForThemeHref(frame, allowed);
      expect(await frame.locator("#buncus-theme").getAttribute("crossorigin")).toBe("anonymous");
      const color = await frame.locator(".bc-root").evaluate((el) => getComputedStyle(el).color);
      expect(color).toBe("rgb(230, 237, 243)"); // the external dark theme actually loaded + applied
    } finally {
      await ctx.close();
    }
  }, 45_000);
});
