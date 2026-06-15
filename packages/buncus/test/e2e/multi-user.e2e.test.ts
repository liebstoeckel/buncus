// Multi-user / multi-page end-to-end browser test (Playwright + bun:test).
// Two real users (alice, bob) in separate browser contexts interact across two
// article pages (different data-term => different discussion threads), all
// against @buncus/mock-github (no GitHub access):
//
//   - alice signs in and starts a thread on Article A (lazily created)
//   - bob (his own context, own session) sees it, reacts ❤️, and replies
//   - alice reloads and sees bob's reaction + reply (her ❤️ stays un-pressed)
//   - Article B is a separate thread (no cross-page bleed)
//
// Each context picks its user via the mock's `?mock_user=<login>` OAuth
// affordance, injected into the authorize navigation with context.route.
// Skips cleanly if Chromium isn't installed (mirrors the repo's e2e convention).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createMockGitHub, type MockGitHubServer } from "@buncus/mock-github";
import { type Browser, chromium, type FrameLocator, type Page } from "playwright";
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

d("buncus multi-user / multi-page e2e (headless chromium)", () => {
  beforeAll(async () => {
    // Mock GitHub + two extra end users (dev is the seeded default viewer).
    mock = createMockGitHub().listen(0);
    const repo = mock.store.getRepo("acme/docs")!;
    repoId = repo.id;
    categoryId = repo.categories[0].id;
    mock.store.addUser({
      login: "alice",
      avatarUrl: "https://avatars.githubusercontent.com/u/11?v=4",
      url: "https://github.com/alice",
    });
    mock.store.addUser({
      login: "bob",
      avatarUrl: "https://avatars.githubusercontent.com/u/12?v=4",
      url: "https://github.com/bob",
    });
    // Page B starts populated by dev; Page A starts empty (alice creates it).
    const discB = mock.store.createDiscussion({
      repositoryId: repo.id,
      categoryId,
      title: "article-b",
      body: "seed B\n\n<!-- sha1: b -->",
    });
    mock.store.addComment(discB.id, mock.store.viewerUserId, "Page B existing comment by **dev**.");

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
    setConfig({ publicUrl: buncusOrigin });

    hostServer = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/a") return html(hostPage("article-a", "Article A"));
        if (path === "/b") return html(hostPage("article-b", "Article B"));
        return new Response("not found", { status: 404 });
      },
    });
    hostOrigin = `http://localhost:${hostServer.port}`;
    setConfig({ origins: [hostOrigin] }); // allow the host to OAuth-redirect + embed (C1/M6)

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

  function html(body: string): Response {
    return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  function hostPage(term: string, title: string): string {
    // consent="skip" keeps the test focused on the multi-user flow (the consent
    // gate has its own coverage in widget.e2e).
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="description" content="${title}"><title>${title}</title></head>
<body><h1>${title}</h1>
<script src="${buncusOrigin}/buncus.js"
  data-repo="acme/docs" data-repo-id="${repoId}"
  data-category="General" data-category-id="${categoryId}"
  data-mapping="specific" data-term="${term}"
  data-theme="light" data-consent="skip"
  crossorigin="anonymous" async></script>
</body></html>`;
  }

  /** Sign in as a specific seeded user. The mock auto-approves OAuth as its
   *  current `viewerUserId`; pointing it at the target user before the flow is
   *  the server-side equivalent of the `?mock_user=<login>` URL affordance
   *  (which `userByLogin` also backs). Sign-ins are serialized, and the token
   *  binds to the user at code-exchange, so this is race-free across contexts. */
  async function signInAs(page: Page, login: string): Promise<FrameLocator> {
    const target = mock.store.userByLogin(login);
    if (!target) throw new Error(`unknown seeded user: ${login}`);
    mock.store.viewerUserId = target.id;
    await page
      .frameLocator("iframe.buncus-frame")
      .getByRole("button", { name: /sign in with github/i })
      .click();
    await page.waitForLoadState("networkidle");
    const frame = page.frameLocator("iframe.buncus-frame");
    await frame.getByRole("button", { name: /sign out/i }).waitFor({ timeout: 20_000 });
    return frame;
  }

  test("two users across two pages: comment, reaction, reply, and isolation", async () => {
    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    try {
      // --- Step 1: alice starts the thread on Article A (lazily created) ------
      const alicePage = await aliceCtx.newPage();
      await alicePage.goto(`${hostOrigin}/a`);
      let aFrame = page0Frame(alicePage);
      await aFrame.getByText(/no comments yet/i).waitFor();
      aFrame = await signInAs(alicePage, "alice");
      await aFrame.locator("textarea.bc-textarea").fill("Alice starts the thread on **Article A**.");
      await aFrame.getByRole("button", { name: /^comment$/i }).click();
      await aFrame.getByText("Alice starts the thread").waitFor({ timeout: 20_000 });
      // attributed to alice
      await aFrame.getByRole("link", { name: "alice" }).waitFor();

      // --- Step 2: bob (own context/session) sees it, reacts, replies --------
      const bobPage = await bobCtx.newPage();
      await bobPage.goto(`${hostOrigin}/a`);
      let bFrame = page0Frame(bobPage);
      await bFrame.getByText("Alice starts the thread").waitFor(); // cross-user visibility
      await bFrame.getByRole("button", { name: /sign in with github/i }).waitFor(); // his context has no session
      bFrame = await signInAs(bobPage, "bob");

      const heartSel = "article.bc-comment > .bc-reactions button[title='heart']";
      await bFrame.locator(heartSel).click();
      await bFrame.locator(`${heartSel}.bc-reaction--active`).waitFor({ timeout: 20_000 });
      expect(await bFrame.locator(heartSel).locator(".bc-reaction__count").textContent()).toBe("1");
      expect(await bFrame.locator(heartSel).getAttribute("aria-pressed")).toBe("true");

      await bFrame.locator("article.bc-comment .bc-comment__footer button").click(); // open reply box
      await bFrame.locator("article.bc-comment textarea.bc-textarea").fill("Bob replies — nice thread!");
      await bFrame.locator("article.bc-comment .bc-box button.bc-btn--primary").click();
      await bFrame.getByText("Bob replies").waitFor({ timeout: 20_000 });
      await bFrame.locator(".bc-reply").getByRole("link", { name: "bob" }).waitFor();

      // --- Step 3: alice reloads → sees bob's reply + ❤️ (un-pressed for her) -
      await alicePage.reload();
      aFrame = page0Frame(alicePage);
      await aFrame.getByText("Bob replies").waitFor({ timeout: 20_000 });
      const aliceHeart = aFrame.locator("article.bc-comment > .bc-reactions button[title='heart']");
      await aliceHeart.locator(".bc-reaction__count").waitFor();
      expect(await aliceHeart.locator(".bc-reaction__count").textContent()).toBe("1");
      expect(await aliceHeart.getAttribute("aria-pressed")).toBe("false"); // she didn't react

      // --- Step 4: Article B is a separate thread (no cross-page bleed) -------
      const pageB = await aliceCtx.newPage();
      await pageB.goto(`${hostOrigin}/b`);
      const bbFrame = page0Frame(pageB);
      await bbFrame.getByText("Page B existing comment").waitFor();
      expect(await bbFrame.getByText("Alice starts the thread").count()).toBe(0);

      // --- Step 5: server-side ground truth ----------------------------------
      const discA = mock.store.searchDiscussions('repo:acme/docs in:title "article-a"')[0]!;
      const top = mock.store.topLevelComments(discA.id);
      expect(top).toHaveLength(1);
      expect(top[0]?.body).toContain("Alice starts the thread");
      expect(mock.store.users.get(top[0]?.authorId)?.login).toBe("alice");
      expect(top[0]?.reactions.get("HEART")?.size).toBe(1);
      const replies = mock.store.repliesOf(top[0]?.id);
      expect(replies).toHaveLength(1);
      expect(mock.store.users.get(replies[0]?.authorId)?.login).toBe("bob");
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  }, 120_000);

  function page0Frame(page: Page): FrameLocator {
    return page.frameLocator("iframe.buncus-frame");
  }
});
