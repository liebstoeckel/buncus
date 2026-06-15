#!/usr/bin/env bun
// Live demo: seeded mock GitHub + the buncus binary + a host page embedding the
// loader. For manual / browser verification. Ctrl-C to stop.
import { generateKeyPairSync } from "node:crypto";
import { createMockGitHub } from "@buncus/mock-github";
import { renderDemoPage } from "../demo/page.ts";

const mock = createMockGitHub().listen(4655);
const repo = mock.store.getRepo("acme/docs")!;
const general = repo.categories[0];

// Seed a discussion (term "guide/start") with a comment + a reaction.
const disc = mock.store.createDiscussion({
  repositoryId: repo.id,
  categoryId: general.id,
  title: "guide/start",
  body: "Seed discussion\n\n<!-- sha1: seed -->",
});
const comment = mock.store.addComment(
  disc.id,
  mock.store.viewerUserId,
  "Hello from **buncus**! Try some `code` and a [link](https://example.com).",
);
mock.store.toggleReaction(comment.id, "HEART", mock.store.viewerUserId, true);

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
// Host the demo reaches the services on. Defaults to localhost; set DEMO_HOST
// to the machine's LAN/IP (see `ip a`) when viewing from a remote browser, so
// the loader URL, public URL, and the ORIGINS allowlist all agree.
const HOST = process.env.DEMO_HOST ?? "localhost";
const BUNCUS = `http://${HOST}:4699`;
const HOST_PAGE = `http://${HOST}:4700`;
const proc = Bun.spawn(["./dist/buncus"], {
  env: {
    ...process.env,
    PORT: "4699",
    BUNCUS_PUBLIC_URL: BUNCUS,
    GITHUB_API_HOST: mock.url,
    GITHUB_OAUTH_HOST: mock.url,
    GITHUB_APP_ID: mock.store.appId,
    GITHUB_CLIENT_ID: mock.store.clientId,
    GITHUB_CLIENT_SECRET: mock.store.clientSecret,
    GITHUB_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    ENCRYPTION_PASSWORD: "demo-password-demo-password-demo-password",
    BUNCUS_DB: ":memory:",
    ORIGINS: JSON.stringify([HOST_PAGE]), // the demo host page origin (C1/M6)
  },
  stdout: "inherit",
  stderr: "inherit",
});

Bun.serve({
  port: 4700,
  async fetch(req) {
    const url = new URL(req.url);
    // Default follows the OS (same source as the host page's colours), so an
    // unparametrised load can't show a dark page with a light widget.
    const theme = url.searchParams.get("theme") || "preferred_color_scheme";
    const html = await renderDemoPage({ origin: BUNCUS, repoId: repo.id, categoryId: general.id, theme });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`
demo host page : ${HOST_PAGE}/         (light)
                 ${HOST_PAGE}/?theme=dark
buncus binary  : ${BUNCUS}
mock github    : ${mock.url}
seeded         : discussion "guide/start" with 1 comment + 1 ❤️
`);

process.on("SIGINT", () => {
  proc.kill();
  mock.stop();
  process.exit(0);
});
