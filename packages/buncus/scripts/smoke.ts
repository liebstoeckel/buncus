#!/usr/bin/env bun
// Smoke-test the COMPILED binary against the mock GitHub, over real HTTP.
import { generateKeyPairSync } from "node:crypto";
import { createMockGitHub } from "@buncus/mock-github";

const mock = createMockGitHub().listen(0);
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PORT = 4699;
const PUBLIC = `http://localhost:${PORT}`;

const proc = Bun.spawn(["./dist/buncus"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    BUNCUS_PUBLIC_URL: PUBLIC,
    GITHUB_API_HOST: mock.url,
    GITHUB_OAUTH_HOST: mock.url,
    GITHUB_APP_ID: mock.store.appId,
    GITHUB_CLIENT_ID: mock.store.clientId,
    GITHUB_CLIENT_SECRET: mock.store.clientSecret,
    GITHUB_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    ENCRYPTION_PASSWORD: "smoke-test-password-smoke-test-password",
    BUNCUS_DB: ":memory:",
    ORIGINS: '["http://site"]', // allow the smoke check's redirect_uri (C1)
  },
  stdout: "inherit",
  stderr: "inherit",
});

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${PUBLIC}/healthz`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("binary did not become ready");
}

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
}

try {
  await waitReady();

  const loader = await fetch(`${PUBLIC}/buncus.js`);
  check("GET /buncus.js", loader.ok && (await loader.text()).includes("buncus"));

  const widget = await fetch(`${PUBLIC}/widget?theme=dark&repo=acme/docs&origin=http://site/p`);
  const widgetHtml = await widget.text();
  check(
    "GET /widget (theme + CSP)",
    widget.ok && widgetHtml.includes("/themes/dark.css") && !!widget.headers.get("content-security-policy"),
  );

  check("GET /default.css", (await fetch(`${PUBLIC}/default.css`)).ok);
  check("GET /themes/preferred_color_scheme.css", (await fetch(`${PUBLIC}/themes/preferred_color_scheme.css`)).ok);

  const cats = await fetch(`${PUBLIC}/api/categories?repo=acme/docs`);
  const catsData = await cats.json();
  check(
    "GET /api/categories",
    cats.ok && catsData.categories?.[0]?.name === "General",
    JSON.stringify(catsData.categories?.[0]),
  );

  const notFound = await fetch(`${PUBLIC}/api/discussions?repo=acme/docs&term=fresh/page`);
  check("GET /api/discussions (404 for new term)", notFound.status === 404);

  const authorize = await fetch(`${PUBLIC}/api/oauth/authorize?redirect_uri=${encodeURIComponent("http://site/p")}`, {
    redirect: "manual",
  });
  check(
    "GET /api/oauth/authorize (302 -> GitHub)",
    authorize.status === 302 && (authorize.headers.get("location")?.startsWith(mock.url) ?? false),
  );
} finally {
  proc.kill();
  mock.stop();
}

console.log(failures === 0 ? "\nSMOKE OK" : `\nSMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
