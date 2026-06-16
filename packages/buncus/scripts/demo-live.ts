#!/usr/bin/env bun
// Live smoke demo against REAL GitHub. Runs the compiled buncus binary pointed
// at api.github.com plus a host page embedding the loader for a real repo whose
// GitHub App is installed. Unlike `demo` (which seeds @liebstoeckel/buncus-mock-
// github and needs no GitHub access), this talks to GitHub for real: anonymous
// reads use the App installation token, sign-in + posting use your user token.
//
//   bun run demo:live
//
// Secrets are read from packages/buncus/.env.demo.local (gitignored); see
// .env.demo.local.example for the keys. The GitHub App must be installed on
// DEMO_REPO with Discussions: Read and write, and its OAuth callback URL must
// equal the printed callback (http://localhost:4600/api/oauth/authorized by
// default). Ctrl-C to stop.
import { randomBytes } from "node:crypto";
import { renderDemoPage } from "../demo/page.ts";

const ROOT = new URL("..", import.meta.url).pathname; // packages/buncus/

// .env.demo.local is not a Bun-recognised dotenv name (it only auto-loads .env,
// .env.local, .env.<NODE_ENV>[.local]), so parse it ourselves. Process env wins,
// so any key can be overridden inline: GITHUB_CLIENT_SECRET=… bun run demo:live
async function loadEnvFile(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  const out: Record<string, string> = {};
  for (const raw of (await file.text()).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = { ...(await loadEnvFile(`${ROOT}.env.demo.local`)), ...process.env };

function fail(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}
function need(key: string): string {
  const v = env[key];
  if (!v) fail(`Missing ${key}. Add it to packages/buncus/.env.demo.local (see .env.demo.local.example).`);
  return v;
}

const REPO = env.DEMO_REPO || "liebstoeckel/buncus";
const CATEGORY = env.DEMO_CATEGORY || "General";
const MAPPING = env.DEMO_MAPPING || "specific";
const TERM = env.DEMO_TERM || "buncus-localhost-demo";
const CONSENT = env.DEMO_CONSENT || "skip";
const HOST = env.DEMO_HOST || "localhost";
const BUNCUS_PORT = env.DEMO_BUNCUS_PORT || "4600";
const PAGE_PORT = env.DEMO_PAGE_PORT || "4601";

const BUNCUS = `http://${HOST}:${BUNCUS_PORT}`;
const HOST_PAGE = `http://${HOST}:${PAGE_PORT}`;
const CALLBACK = `${BUNCUS}/api/oauth/authorized`;

const clientId = need("GITHUB_CLIENT_ID");
const clientSecret = need("GITHUB_CLIENT_SECRET");
// GitHub accepts the App's client ID as the JWT issuer, so the numeric App ID is
// optional; fall back to the client ID (which is what buncus signs `iss` with).
const appId = env.GITHUB_APP_ID || clientId;

// Private key: an inline PEM wins, else read the file at GITHUB_PRIVATE_KEY_PATH.
let privateKey = env.GITHUB_PRIVATE_KEY || "";
if (!privateKey) {
  const keyPath = need("GITHUB_PRIVATE_KEY_PATH");
  const kf = Bun.file(keyPath);
  if (!(await kf.exists())) fail(`GITHUB_PRIVATE_KEY_PATH points at a missing file: ${keyPath}`);
  privateKey = await kf.text();
}

// Sessions are throwaway for a demo, so generate a key unless one is pinned.
const encryptionPassword = env.ENCRYPTION_PASSWORD || randomBytes(24).toString("hex");

if (!(await Bun.file(`${ROOT}dist/buncus`).exists())) {
  fail("dist/buncus not found. Build it first: bun run compile (the demo:live script does this for you).");
}

const proc = Bun.spawn([`${ROOT}dist/buncus`], {
  env: {
    ...env,
    PORT: BUNCUS_PORT,
    BUNCUS_PUBLIC_URL: BUNCUS,
    // Real GitHub. Left overridable for GHES, but never the mock here.
    GITHUB_API_HOST: env.GITHUB_API_HOST || "https://api.github.com",
    GITHUB_OAUTH_HOST: env.GITHUB_OAUTH_HOST || "https://github.com",
    GITHUB_APP_ID: appId,
    GITHUB_CLIENT_ID: clientId,
    GITHUB_CLIENT_SECRET: clientSecret,
    GITHUB_PRIVATE_KEY: privateKey,
    ENCRYPTION_PASSWORD: encryptionPassword,
    BUNCUS_DB: ":memory:",
    ORIGINS: JSON.stringify([HOST_PAGE]), // the host page origin (fragment + API gate)
    BUNCUS_MOCK: "", // force the real path even if it is set in the shell
  },
  stdout: "inherit",
  stderr: "inherit",
});

function shutdown(code = 0): never {
  proc.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));

// Wait for the binary to come up (config errors make it exit; surface that).
async function waitReady(tries = 40, delayMs = 250): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (proc.exitCode !== null) return false; // binary already died (bad config)
    try {
      if ((await fetch(`${BUNCUS}/healthz`)).ok) return true;
    } catch {}
    await Bun.sleep(delayMs);
  }
  return false;
}
if (!(await waitReady()))
  fail(`buncus did not come up on ${BUNCUS}. See the log above (likely a config/secret error).`);

// Self-discover the repo + category IDs through buncus itself (installation
// token, no sign-in). This doubles as the install check.
const catRes = await fetch(`${BUNCUS}/api/categories?repo=${encodeURIComponent(REPO)}`);
const cats = (await catRes.json()) as { repositoryId?: string; categories?: { id: string; name: string }[] };
if (!catRes.ok || !cats.repositoryId || !cats.categories?.length) {
  console.error(`
  Could not resolve ${REPO} via the installation token (HTTP ${catRes.status}).
  Response: ${JSON.stringify(cats)}

  Checklist:
   - Is the GitHub App installed on ${REPO}?
   - Is Discussions enabled on the repo (Settings -> Features -> Discussions)?
   - Is the private key the App .pem, not the client secret?
   - Did you accept the permissions if you changed them after installing?`);
  shutdown(1);
}

const category = cats.categories.find((c) => c.name === CATEGORY) ?? cats.categories[0];
const repoId = cats.repositoryId;
const categoryId = category.id;

Bun.serve({
  port: Number(PAGE_PORT),
  async fetch(req) {
    const url = new URL(req.url);
    const theme = url.searchParams.get("theme") || "preferred_color_scheme";
    const html = await renderDemoPage({
      origin: BUNCUS,
      repoId,
      categoryId,
      theme,
      repo: REPO,
      category: category.name,
      mapping: MAPPING,
      term: TERM,
      consent: CONSENT,
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`
buncus (live)  : ${BUNCUS}            -> REAL GitHub (api.github.com)
demo host page : ${HOST_PAGE}/            (light)
                 ${HOST_PAGE}/?theme=dark
repo           : ${REPO}
category       : ${category.name}  (${categoryId})
repo id        : ${repoId}
mapping        : ${MAPPING}${MAPPING === "specific" ? `  term="${TERM}"` : ""}
categories seen: ${cats.categories.map((c) => c.name).join(", ")}

  OAuth callback URL on the GitHub App must be exactly:
    ${CALLBACK}

Open the host page, read the thread anonymously, then sign in and post a
comment to exercise the full read + OAuth + write path. Ctrl-C to stop.
`);
