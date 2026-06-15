#!/usr/bin/env bun
import { generateKeyPairSync } from "node:crypto";
// Capture real screenshots of the widget (consent gate, light, dark) for visual
// verification. Same stack as the e2e: seeded mock + buncus + host page.
import { mkdirSync } from "node:fs";
import { createMockGitHub } from "@buncus/mock-github";
import { chromium } from "playwright";
import { renderDemoPage } from "../demo/page.ts";
import { resetConfig, setConfig } from "../src/config.ts";
import { createServer } from "../src/server.ts";

const OUT = new URL("../dist/shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const mock = createMockGitHub().listen(0);
const repo = mock.store.getRepo("acme/docs")!;
const cat = repo.categories[0];
const disc = mock.store.createDiscussion({
  repositoryId: repo.id,
  categoryId: cat.id,
  title: "guide/start",
  body: "seed\n\n<!-- sha1: seed -->",
});
const c1 = mock.store.addComment(
  disc.id,
  mock.store.viewerUserId,
  "Hello from **buncus** — comments hosted from a single binary. Try `inline code` and a [link](https://example.com).",
);
mock.store.toggleReaction(c1.id, "HEART", mock.store.viewerUserId, true);
mock.store.toggleReaction(c1.id, "ROCKET", mock.store.viewerUserId, true);
mock.store.addComment(disc.id, mock.store.viewerUserId, "A second comment to show threading.", c1.id);

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
  encryptionPassword: "shot-password-shot-password-shot-password",
  dbPath: ":memory:",
  origins: [],
  originsRegex: [],
});
const app = createServer();
const buncus = Bun.serve({ port: 0, fetch: app.fetch });
const buncusOrigin = `http://localhost:${buncus.port}`;
setConfig({ publicUrl: buncusOrigin });

const host = Bun.serve({
  port: 0,
  async fetch(req) {
    const theme = new URL(req.url).searchParams.get("theme") ?? "light";
    return new Response(await renderDemoPage({ origin: buncusOrigin, repoId: repo.id, categoryId: cat.id, theme }), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
const hostOrigin = `http://localhost:${host.port}`;

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

async function shot(theme: string, file: string, load: boolean) {
  const page = await browser.newPage({
    viewport: { width: 820, height: 900 },
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  await page.goto(`${hostOrigin}/?theme=${theme}`);
  await page.locator(".buncus-consent").waitFor({ state: "visible" });
  if (load) {
    await page.locator(".buncus-consent__load").click();
    await page.frameLocator("iframe.buncus-frame").locator(".bc-comment").first().waitFor({ state: "visible" });
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${OUT}${file}`, fullPage: true });
  console.log(`wrote ${OUT}${file}`);
  await page.close();
}

await shot("light", "1-consent-gate.png", false);
await shot("light", "2-widget-light.png", true);
await shot("dark", "3-widget-dark.png", true);

await browser.close();
buncus.stop(true);
host.stop(true);
mock.stop();
