# buncus — a Bun-native, single-binary GitHub Discussions comment platform

**Status:** original pre-implementation plan · **Source of truth for reverse-engineering:** `./giscus-eval` (shallow clone of `giscus/giscus`, MIT) · **Target runtime:** Bun ≥ 1.3

> ⚠️ **This is the original plan.** For the **as-built architecture and the full design-decision log**, read [`ARCHITECTURE.md`](./ARCHITECTURE.md) — it records where the implementation deliberately diverged from this spec (e.g. all GitHub traffic is proxied server-side; the widget is client-rendered, not SSR; 3 themes not 24). This SPEC is retained as the design narrative and the giscus reverse-engineering reference.

> buncus is a from-scratch reimplementation of [giscus](https://giscus.app) as a **single self-contained executable**. Same embed contract (drop-in `<script>` swap), same GitHub-Discussions-as-backend model, but: Bun everywhere (`Bun.serve`, `bun:sqlite`, `bun build --compile`, `bun test`, native `crypto.subtle`, React 19 SSR), no Next.js / Vercel / Supabase / Valkey / Preact, and **GDPR-by-default** — nothing touches GitHub until the visitor opts in (consent toggle before the iframe is inlined).

---

## 0. Why this is tractable

giscus is **not heavy because it does a lot** — the whole thing is ~6k LOC of TS/TSX. It's heavy because of its *packaging*: Next.js Pages Router + Vercel serverless + a choice of three external token caches (Supabase / PostgREST / Valkey) + a Preact-alias + a four-tool build chain (`tsc` + `postcss` + `google-closure-compiler` + `next build`). Every one of those collapses to a Bun primitive:

| giscus dependency | buncus replacement |
|---|---|
| Next.js Pages Router + API routes | `Bun.serve({ routes })` |
| Vercel hosting / `vercel.json` | the single binary, run anywhere |
| `next build` + `tsc` + `postcss` + `google-closure-compiler` | `bun build` (+ `--compile`) |
| Supabase / PostgREST / Valkey token cache | `bun:sqlite` (one table) |
| `@valkey/valkey-glide`, supabase/postgrest HTTP | deleted |
| Preact (`react`→`@preact/compat` alias) | real **React 19** |
| `react-ssr-prepass` | React 19 `renderToReadableStream` / `renderToString` |
| `next-translate` + custom loader | tiny JSON loader over `locales/` + `i18n.fallbacks.json` |
| `lib/adapter.ts` `webcrypto` shim (dynamic `import('crypto')`) | global `crypto.subtle` (native in Bun) |
| `jsonwebtoken` (App JWT RS256) | keep, or `crypto.subtle` RSASSA-PKCS1 (see §6.3) |
| SWR `^2.3` | keep (works under React 19) — or a thin custom hook |
| `dompurify`, `mathjax`, `lit-html`, `@primer/octicons-react` | keep as-is (all Bun-native) |

Net: the reimplementation is mostly **deletion + re-housing**, not invention.

---

## 1. Architecture

buncus is **two halves talking over `postMessage` across an iframe boundary**, plus a thin GitHub proxy. The binary serves all of it from one origin.

```
   embedding page (docs site)                  buncus binary (one origin, one process)
 ┌───────────────────────────┐             ┌──────────────────────────────────────────┐
 │ <script src=buncus.js      │  GET        │  /buncus.js     (loader, static, embedded) │
 │   data-repo=… data-…>      │────────────▶│  /default.css   (parent CSS, embedded)     │
 │                            │             │  /themes/*.css  (25 themes, embedded)      │
 │  ┌──────────────────────┐  │  iframe src │  GET /{lang?}/widget?…   (React SSR)       │
 │  │ CONSENT GATE (NEW)    │  │────────────▶│      ├─ per-request CSP + origin gating    │
 │  │  toggle → inline      │  │             │      └─ ships React app + embedded config  │
 │  ├──────────────────────┤  │             │                                            │
 │  │ <iframe> widget app   │  │  postMessage│  POST /api/oauth/token   (session→token)   │
 │  │  React 19 + SWR       │◀─┼─────────────│  GET  /api/oauth/authorize (→ GitHub)      │
 │  └──────────────────────┘  │             │  GET  /api/oauth/authorized (GitHub cb)    │
 └───────────────────────────┘             │  GET/POST /api/discussions  (proxy reads)  │
                │                            │  GET  /api/discussions/categories          │
                │ reads via backend          │  POST /api/webhook  (200 stub)             │
                │ writes direct to GitHub     │                                            │
                ▼                            │  bun:sqlite  ← App installation-token cache │
   api.github.com/graphql  (Bearer user token)└──────────────────────────────────────────┘
   api.github.com/markdown
            ▲ App installation token minted here (JWT) for anonymous reads + createDiscussion
```

**Split data plane (preserve exactly):**
- **Reads** (discussion thread, categories) go through the binary's `/api/discussions*` — which attaches a **user token** (if signed in) or mints a **GitHub App installation token** for anonymous reads.
- **Writes** (add comment/reply, toggle reaction/upvote) and **markdown preview** go **directly browser→`api.github.com`** with the user's bearer token. The binary never proxies writes.
- **OAuth token exchange** and **discussion creation** go through the binary.

---

## 2. The compatibility contract (must stay drop-in)

To be a true giscus replacement, swapping the script `src` must be the only change a site makes. These contracts are **frozen**.

### 2.1 `data-*` attributes (read from the `<script>` tag)

| Attribute | iframe param | Default | Meaning |
|---|---|---|---|
| `data-repo` | `repo` | *(required)* | `owner/name` |
| `data-repo-id` | `repoId` | *(required)* | repo node ID |
| `data-category` | `category` | `''` | category name |
| `data-category-id` | `categoryId` | — | category node ID |
| `data-mapping` | → `term`/`number` | `pathname` | `pathname｜url｜title｜og:title｜specific｜number` |
| `data-term` | `term` or `number` | — | term for `specific`, number for `number` |
| `data-strict` | `strict` | `0` | `1` = SHA-1-of-title strict match |
| `data-reactions-enabled` | `reactionsEnabled` | `1` | main reactions bar |
| `data-emit-metadata` | `emitMetadata` | `0` | emit `IMetadataMessage` |
| `data-input-position` | `inputPosition` | `bottom` | `top｜bottom` |
| `data-theme` | `theme` | `preferred_color_scheme` | built-in name, `/path`, or `https://…` CSS |
| `data-lang` | URL path segment | `''` | `/{lang}/widget` |
| `data-loading` | iframe `loading` | eager | `lazy` |
| `crossorigin` | (on `<script>`) | — | passthrough in snippets |

Plus, not `data-*`: `<meta name="description">`/`og:description` → `description`; `<meta name="giscus:backlink">` → `backLink` (we also accept `buncus:backlink`); `?giscus=<token>` parent URL param → session (OAuth return); `<div class="giscus" id="…">` placeholder → reuse container + anchor.

**Mapping resolution** happens entirely in the loader. `pathname` (default): `location.pathname` minus leading `/` and file extension, `'index'` for root. `number` sets `number` (not `term`) and bypasses search/auto-create.

### 2.2 iframe URL shape

```
<scriptOrigin>[/<lang>]/widget?origin=…&session=…&theme=…&reactionsEnabled=…&emitMetadata=…
  &inputPosition=…&repo=…&repoId=…&category=…&categoryId=…&strict=…&description=…&backLink=…
  &term=… | &number=…
```
Param keys are **camelCase** (`reactionsEnabled`, `repoId`, `categoryId`, `inputPosition`, `emitMetadata`, `backLink`). `lang` is a **path prefix**, never a query param.

### 2.3 postMessage protocol

Envelope is always `{ <ns>: <payload> }`. **Decision:** default namespace key `buncus`, but support a `compat` build flag that uses `giscus` so existing third-party metadata listeners keep working. Discriminate by payload shape.

**iframe → parent (outbound):**
- `{ resizeHeight: number }` — from a `ResizeObserver` on `<body>`; parent sets iframe height. Most frequent.
- `{ discussion: IDiscussionData, viewer: IUser }` — only when `emitMetadata` enabled and a discussion exists.
- `{ error: string }` — on any data/token error.
- `{ signOut: true, error: 'State has expired (user signed out).' }` — combined; the `error` field is a deliberate back-compat hack so old parents still clear the session.

**parent → iframe (inbound): exactly one type:**
- `{ setConfig: { theme?, repo?, repoId?, category?, categoryId?, term?, description?, backLink?, number?, strict?, reactionsEnabled?, emitMetadata?, inputPosition?, lang? } }` — `theme` and `lang` are pulled out (theme → live `<link>` swap; lang → route replace); the rest merge into the config context. **There is no separate `setTheme`/`signOut` inbound message.**

**Loader behavior on inbound:** acts only on `resizeHeight`, `signOut`, `error`. Always checks `event.origin === scriptOrigin` and `data.<ns>` present.

### 2.4 Error-string contract (load-bearing — the loader string-matches)

The widget emits these substrings and the loader keys session-clearing off them:
- `Bad credentials` / `Invalid state value` / `State has expired` → clear `*-session` + reload iframe.
- `Discussion not found` → warn (created on first comment/reaction).
- `API rate limit exceeded` → warn.

Keep these strings verbatim.

### 2.5 localStorage keys

- Session: giscus uses `giscus-session` (JSON-stringified). buncus uses **`buncus-session`** (own origin, no cross-compat needed).
- Consent: **`buncus-consent`** (new, see §3).

---

## 3. GDPR-by-default: the consent gate (the one real addition)

This is the headline feature and the reason to self-host. Even self-hosted, the **iframe still talks to GitHub** (avatars from `*.githubusercontent.com`, `api.github.com`), so GitHub remains a third-party/third-country recipient. Under GDPR/§25 TTDSG that requires **prior opt-in**. So:

**The loader does NOT create the iframe on load.** It renders a small, self-contained, localized **consent placeholder** in the `.giscus`/`.buncus` slot:

1. Placeholder markup + styles are **inlined by the loader** (no network at all pre-consent — not even `default.css`, which is only injected alongside the iframe). Contains: a one-line notice ("Comments are loaded from GitHub. This transmits your IP to GitHub Inc. (USA). [Load comments] [Always load]"), a primary "Load comments" button, and an "Always load" checkbox/toggle.
2. **On click "Load comments"** → inject the iframe for this page view only.
3. **On "Always load" (toggle) → opt-in persisted** to `localStorage['buncus-consent'] = 'granted'`; future page loads auto-inject without showing the gate.
4. A revoke path: a tiny "×/settings" affordance in the widget footer posts `{ revokeConsent: true }` to the parent (new outbound message) → loader removes the iframe, clears `buncus-consent`, restores the placeholder.

**Config knobs (new `data-*`):**
- `data-consent` = `required` (default) ｜ `skip` (legacy giscus behavior, auto-load — for sites that gate consent themselves upstream) ｜ `optin-remember` (show once, remember).
- `data-consent-text`, `data-consent-lang` (falls back to `data-lang`) to localize/override the notice; default copy ships per-locale alongside the existing i18n bundle (`consent.json` namespace).
- `data-privacy-url` — link rendered in the notice to the site's Datenschutzerklärung.

**Invariant:** with `data-consent=required` and no stored grant, **zero requests leave the browser** until the user acts — not to the binary, not to GitHub. This is the property that makes the embed defensible on a German site. (Document it; add an e2e test asserting no network egress pre-consent.)

The privacy story self-hosted: processor chain reduces to **GitHub (storage, has a DPA) + your own first-party binary**. No Vercel/Supabase/unnamed-operator leg. Consent gate covers the residual GitHub transfer.

---

## 4. Project layout (`~/WebstormProjects/buncus`)

```
buncus/
├── SPEC.md                      ← this file
├── giscus-eval/                 ← reference clone (gitignored or kept as submodule-style ref)
├── package.json                 ← Bun workspace; "type": "module"; scripts below
├── bunfig.toml
├── tsconfig.json                ← strict, verbatimModuleSyntax, allowImportingTsExtensions
├── src/
│   ├── server.ts                ← Bun.serve entry; route table; header/cache middleware
│   ├── config.ts                ← env parsing (all knobs, §6.6), URL builders
│   ├── routes/
│   │   ├── widget.tsx           ← GET /{lang?}/widget — React SSR + CSP/origin gating
│   │   ├── oauth.authorize.ts
│   │   ├── oauth.authorized.ts
│   │   ├── oauth.token.ts
│   │   ├── discussions.ts       ← GET (read proxy) + POST (create)
│   │   ├── discussions.categories.ts
│   │   └── webhook.ts           ← 200 stub
│   ├── github/                  ← GraphQL/REST ops (port of services/github/*)
│   │   ├── graphql.ts           ← query/mutation strings (§6.5) + typed fetch
│   │   ├── appToken.ts          ← JWT + installation-token mint (§6.3)
│   │   ├── oauth.ts             ← code→token, token validity check
│   │   ├── markdown.ts          ← POST /markdown passthrough helper (client uses直接)
│   │   └── adapters.ts          ← adaptDiscussion/Comment/Reply → IGiscussion (port of lib/adapter.ts)
│   ├── crypto/
│   │   ├── encryption.ts        ← AES-GCM state/session box (§6.2), crypto.subtle
│   │   └── state.ts             ← encodeState/decodeState (TTL)
│   ├── cache/
│   │   └── tokenCache.ts        ← bun:sqlite installation-token cache (§6.4)
│   ├── i18n/                    ← loader over locales/ + fallbacks
│   └── client/                  ← the iframe React app (was components/ + lib/hooks)
│       ├── widget.client.tsx    ← hydration entry
│       ├── components/          ← Giscus, Widget, Comment, CommentBox, Reply, ReactButtons
│       ├── hooks.ts             ← useDiscussion/useFrontBackDiscussion (SWR)
│       ├── messages.ts, context.ts, reactions.ts, theme.ts
│       └── math/                ← math-renderer-element (port; mathjax+dompurify lazy)
├── loader/
│   └── buncus.ts                ← the embed loader (port of client.ts + consent gate §3)
├── assets/
│   ├── default.css              ← parent-page CSS (port of public/default.css)
│   ├── base.css, globals.css    ← widget CSS (Tailwind v4 build output)
│   └── themes/*.css             ← 24 themes + custom_example (port of styles/themes)
├── locales/                     ← copied from giscus + new consent.json per lang
└── test/                        ← bun test; unit + e2e (§9)
```

**Scripts (`package.json`):**
```jsonc
{
  "scripts": {
    "dev":        "bun --hot src/server.ts",
    "build:css":  "bunx @tailwindcss/cli -i assets/src.css -o assets/base.css --minify",
    "build:loader":"bun build loader/buncus.ts --outfile dist/buncus.js --minify --target browser",
    "build:client":"bun build src/client/widget.client.tsx --outfile dist/widget.js --minify --target browser",
    "build":      "bun run build:css && bun run build:loader && bun run build:client",
    "compile":    "bun run build && bun build src/server.ts --compile --outfile dist/buncus",
    "test":       "bun test",
    "typecheck":  "tsc --noEmit"
  }
}
```

---

## 5. Single-binary packaging (Bun-native)

The whole point: **one file you run anywhere**, no Node, no `node_modules`, no static-asset directory to deploy.

- **`bun build --compile`** bundles `src/server.ts` + all imports into a standalone executable.
- **Static assets** (`dist/buncus.js`, `dist/widget.js`, `assets/default.css`, `assets/themes/*.css`, `locales/**`) are embedded by importing them with `with { type: "file" }` (Bun copies them into the binary and exposes a runtime path) or read via `Bun.embeddedFiles`. The route handlers serve them from memory.
  ```ts
  import loaderJs from "../dist/buncus.js" with { type: "file" };
  import defaultCss from "../assets/default.css" with { type: "file" };
  // serve: return new Response(Bun.file(loaderJs), { headers: { "content-type": "text/javascript", ...cacheHeaders }});
  ```
- **The widget HTML** is generated per-request (React SSR) — not a static file — because CSP/origin headers and the initial theme `<link>` are per-request (§7.1). The client JS bundle (`dist/widget.js`) is embedded and referenced by the SSR'd document.
- **`bun:sqlite` DB path** is a runtime env (`BUNCUS_DB=/data/buncus.sqlite`), created on boot with `CREATE TABLE IF NOT EXISTS …`. Not embedded (it's mutable state).
- **Build order matters:** CSS → loader → client → `--compile` (so the embedded `dist/*` exist before the binary is built). Encode in the `compile` script.

Result: `./dist/buncus` + a writable dir for the SQLite file + env vars = the entire deployment. Fits the present-it/liebstoeckel ethos exactly (one self-contained artifact, raw TS under Bun).

---

## 6. Backend spec

### 6.1 Routes (Bun.serve)

A small adapter maps `Request`→handler. Note Bun gives you `Request`/`Response` only — **you parse `req.json()`/`req.formData()` yourself** (Next auto-parsed body), read `new URL(req.url).searchParams` for query, and build redirects as `new Response(null, { status: 302, headers: { Location } })`. There are exactly **6 API endpoints** + the widget + static assets.

| Method | Path | Purpose |
|---|---|---|
| GET | `/buncus.js`, `/default.css`, `/themes/*.css` | embedded static, `Cache-Control: public, max-age=0, stale-while-revalidate=604800` |
| GET | `/{lang?}/widget` | React-SSR iframe document; per-request CSP + origin gate |
| GET | `/api/oauth/authorize?redirect_uri=` | encrypt return URL into `state` (5 min TTL), 302 to GitHub authorize |
| GET | `/api/oauth/authorized?code=&state=` | decode state, **POST code+secret to GitHub** for `access_token`, encrypt into 1-yr session, 302 to `<return>?giscus=<session>` |
| POST | `/api/oauth/token` *(CORS)* | `{session}` → decrypt → `{token}` (plaintext GitHub user token) |
| GET/POST | `/api/discussions` *(CORS)* | GET: read thread (user token or App token); POST: create discussion (as the App) |
| GET | `/api/discussions/categories?repo=` *(CORS)* | list categories (user or App token) |
| POST | `/api/webhook` | **no-op 200 stub** (`{success:true}`) — GitHub Marketplace requirement only |

**Headers middleware** (port of `next.config.js`): on every route — `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`, `X-XSS-Protection`, `X-DNS-Prefetch-Control`. The widget route sets CSP `frame-ancestors` dynamically (§7.1). **CORS gap to fix:** giscus only sets `Access-Control-Allow-Origin` (no `OPTIONS`/`Allow-Methods`/`Allow-Headers`). buncus must add proper `OPTIONS` preflight handling + `Access-Control-Allow-Headers: Authorization, Content-Type` for the CORS routes, since real cross-origin POSTs with `Authorization` need it (Vercel/Next may have masked this).

### 6.2 Token encryption (`src/crypto/encryption.ts`)

Port giscus's AES-GCM box **verbatim in algorithm** (so already-issued sessions remain valid if you ever migrate, and because it's correct): key = `SHA-256(password)` (⚠ **unsalted, single static key derived only from `ENCRYPTION_PASSWORD`** — keep this exact behavior; document it as a known property). IV = 12 random bytes. Wire format = `<24 hex IV><base64(ciphertext+16-byte GCM tag)>`. All via global `crypto.subtle` (no import, no `lib/adapter.ts` shim). Bun simplification: use `Buffer.from(new Uint8Array(buf)).toString('base64')` instead of the `String.fromCharCode` round-trips.

`state.ts`: `encodeState(value, password, expires?)` → encrypt `JSON.stringify({value, expires})`; `decodeState` → decrypt, parse, throw `'Invalid state value.'` on failure / `'State has expired.'` when `Date.now() > expires`. Default TTL 5 min; OAuth callback overrides to **1 year** (`1000*60*60*24*365`). The same box does double duty: CSRF/return-URL carrier (short TTL) and long-lived session token (1 yr).

### 6.3 GitHub App auth (`src/github/appToken.ts`)

App JWT (RS256): `{ iat: now-60, exp: now+600, iss: APP_ID }` signed with the PEM private key. **Decision:** keep `jsonwebtoken` (runs under Bun, handles PKCS#1 `BEGIN RSA PRIVATE KEY` PEM directly) for v1; optionally swap to `crypto.subtle.sign({name:'RSASSA-PKCS1-v1_5'})` later (requires PKCS#8 conversion — higher risk, defer). The env PEM has literal `\n`; `.replace(/\\n/g, '\n')` before use.

Installation-token flow: `GET /repos/{repo}/installation` (Bearer App JWT) → `id` (throw `giscus is not installed on this repository` if none) → **cache lookup** → else `POST /app/installations/{id}/access_tokens` → `{token, expires_at}` → **cache store** (preserve original `created_at`). App token is used for anonymous reads and **creating discussions** (discussions are created *by the App*, not the user — even though POST requires a valid user to authorize).

### 6.4 Token cache — `bun:sqlite` (`src/cache/tokenCache.ts`)

Replaces all three giscus backends. Only thing cached = **GitHub App installation access tokens**.

```sql
CREATE TABLE IF NOT EXISTS installation_access_tokens (
  installation_id INTEGER PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
```
Semantics to preserve: **`INTOLERANCE_TIMEOUT = 5 min`** — on `get`, if `expires_at - now < 5min`, return the row **with `token: ''`** (forces re-mint) but keep `created_at`. `set` is an upsert that sets `created_at` only on first write. Use `bun:sqlite` prepared statements; `db.query(...).get()/run()`. Single writer, WAL mode (`PRAGMA journal_mode=WAL`). This is ~40 lines and deletes `valkey-glide` + the supabase/postgrest HTTP code entirely.

### 6.5 GitHub API operations (complete set)

**GraphQL** (`https://api.github.com/graphql`, POST `{query, variables}`, Bearer):

| Op | Type | Variables |
|---|---|---|
| get discussion by **term** | query | `search(type:DISCUSSION last:1 query:$query)` + `$first,$last,$after,$before` |
| get discussion by **number** | query | `repository(owner,name){discussion(number:$number)}` + paging |
| get discussion **categories** | query | `search(type:REPOSITORY query:$query first:1)` |
| **createDiscussion** | mutation | `$input: CreateDiscussionInput!` |
| **addDiscussionComment** | mutation | `$body, $discussionId` |
| **addDiscussionReply** (alias of addDiscussionComment) | mutation | `$body, $discussionId, $replyToId` |
| **toggleReaction** (alias add/removeReaction) | mutation | `$content: ReactionContent!, $subjectId: ID!` |
| **toggleUpvote** (alias add/removeUpvote) | mutation | `$upvoteInput` |

The discussion selection set (`DISCUSSION_QUERY`) selects: `id url locked repository{nameWithOwner} reactions{totalCount} reactionGroups{content users{totalCount} viewerHasReacted} comments(…){totalCount pageInfo nodes{ id upvoteCount viewerHasUpvoted viewerCanUpvote author{avatarUrl login url} viewerDidAuthor createdAt url authorAssociation lastEditedAt deletedAt isMinimized bodyHTML reactionGroups replies(last:100){…replyTo{id}} }}`. Copy these strings **verbatim** from `giscus-eval/services/github/*.ts` — they're load-bearing.

Search query construction: ``repo:<lowercased repo> [category:"<cat>"] in:title "<term>"``; when `strict`: term → `SHA-1(term)` hex and `in:body` (matches the hidden `<!-- sha1: … -->` tag injected at creation). Repo is forced lowercase (GitHub category-query bug). On create, body gets `\n\n<!-- sha1: <SHA-1(title)> -->` appended as the dedup marker.

**REST:** `POST github.com/login/oauth/access_token` (code exchange); `POST /applications/{client_id}/token` Basic `base64(id:secret)` (validate user token, check `app.client_id`); `GET /repos/{repo}/installation` + `POST /app/installations/{id}/access_tokens` (App token); `GET /repos/{repo}/contents/{path}` (fetch `giscus.json` repo config, base64-decode); `POST /markdown` `{mode:'gfm'}` (preview — called client-side).

### 6.6 Environment / config knobs

Required: `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY` (PEM, `\n`-escaped), `ENCRYPTION_PASSWORD`. buncus-specific: `BUNCUS_DB` (sqlite path), `PORT`, `BUNCUS_PUBLIC_URL` (base URL — replaces giscus's reliance on `x-forwarded-proto`/`host` from Vercel's proxy; used to build the OAuth callback). **`GITHUB_API_HOST`** (default `https://api.github.com`) and **`GITHUB_OAUTH_HOST`** (default `https://github.com`) — these MUST be configurable (giscus hard-codes both): pointing them at `@buncus/mock-github` is how the whole stack runs without GitHub access. CORS: `ORIGINS`, `ORIGINS_REGEX` (JSON array strings). Drop all of: `VALKEY_*`, `POSTGREST_*`, `SUPABASE_*`, `GITHUB_INSTALLATION_ID`/`GITHUB_TOKEN` (read-but-unused in giscus). Frontend demo vars (`NEXT_PUBLIC_*`) → not needed except an optional demo-repo config for `/` (we may drop the demo page entirely; see §8).

### 6.7 Webhook

`POST /api/webhook` → `{success:true}` 200, ignores everything. (Optionally verify `X-Hub-Signature-256` and discard; giscus doesn't even do that.)

---

## 7. Frontend spec (the iframe widget)

React 19, SSR'd by the binary, hydrated client-side. SWR (kept) is the only data layer. **Comment bodies are GitHub-rendered HTML (`bodyHTML`)** — buncus does *not* bundle a markdown parser; the only client sanitizer is DOMPurify (math) + giscus's `processCommentBody` link-rewriting.

### 7.1 `GET /{lang?}/widget` — server side

Port of `getServerSideProps` + `_document`:
1. Read query params (§2.2). Decrypt `session` → user token, fall back to App token for `repo`, else `''`.
2. Fetch repo config (`giscus.json` via GitHub contents API): `{ origins?, originsRegex?, defaultCommentOrder? }`.
3. **Origin gating** (`assertOrigin(originHost, repoConfig)`): empty config ⇒ allow all; else exact-match `origins` then regex `originsRegex`. On **failure** → `Content-Security-Policy: frame-ancestors 'none'` + `X-Frame-Options: DENY` + redirect to a "blocked origin" page. On **success** → `Content-Security-Policy: frame-ancestors 'self' <origins…>`. Also `Cross-Origin-Resource-Policy: cross-origin`.
4. Resolve theme → emit initial `<link id="giscus-theme" rel="stylesheet" href={themeUrl} crossorigin="anonymous">` in `<head>` to avoid flash (`preferred_color_scheme` resolves in CSS via `@media`). `<base target="_top">` so OAuth links break out of the iframe.
5. SSR the React shell, serialize resolved config + token availability into an embedded `<script id="buncus-config" type="application/json">` so the client hydrates without a round-trip. Reference embedded `/widget.js`.

**Theme link swap** (runtime): on `setConfig.theme`, create `<link id="giscus-theme-temp">`, on its `load` remove the old `#giscus-theme` and rename — atomic, no flash. Built-in themes → `/themes/<name>.css`; custom → raw URL (keep the "external CSS may be unsafe" warning + `crossorigin="anonymous"`).

### 7.2 Components (port `components/` to React 19)

`Widget` (token exchange via `POST /api/oauth/token`, `ResizeObserver`→`resizeHeight`, `AuthContext`, discussion-create handler) → `Giscus` (`useFrontBackDiscussion`, reactions bar, oldest/newest toggle, load-more, comment box placement) → `Comment`/`Reply`/`ReactButtons`/`CommentBox`. Keep `@primer/octicons-react`. Upvote button stays force-disabled (GitHub doesn't allow app-issued user tokens to upvote). The `Configuration`/home-page generator is optional (§8).

### 7.3 Data hooks (`useDiscussion` / `useFrontBackDiscussion`)

Port verbatim — this is the subtle part:
- `useDiscussion(query, token?, pagination, revalidateFirstPage)` over `useSWRInfinite`, keyed on `['/api/discussions?'+params, headers]` where `headers = token ? {Authorization:'Bearer '+token} : {}`. **Retry/revalidate gating:** `shouldRevalidate(status) = ![403,404,429].includes(status)` (don't retry forbidden/not-found/rate-limited).
- `useFrontBackDiscussion(query, token, orderBy)` loads **both ends** (`{last:15}` + `{first:15}`), client-side de-dups the front stream against the back's first id (`intersectId`), "load more" = `setSize(size+1)` on the front, `numHidden` drives the button, and `orderBy==='newest'` swaps/reverses front↔back + mutator sets.
- Optimistic mutators (`addNewComment/Reply`, `updateComment/Reply/Discussion`, `updateReactions`) via SWR `mutate(data,false)` then revalidate.
- Writes/preview go **direct to `api.github.com`** (GraphQL mutations + `/markdown`), not through the binary.

### 7.4 Auth flow (client)

Sign-in link `=/api/oauth/authorize?redirect_uri=<origin>` with `target="_top"`. After GitHub round-trip the parent gets `?giscus=<session>`; the **loader** lifts it to `localStorage['buncus-session']`, scrubs the URL, and passes `session` into the iframe `src`. Widget exchanges `session`→token via `POST /api/oauth/token`. Sign-out emits `{signOut:true, error:'State has expired (user signed out).'}`; loader clears storage + reloads iframe sans session.

### 7.5 i18n

Port `locales/` (35 langs, `common.json` + `config.json`; add `consent.json`). Replace `next-translate` with a tiny loader: `import` the JSON per locale, apply `i18n.fallbacks.json` (`gsw→de`, `zh-Hans→zh-CN`, `zh-Hant→zh-TW`). Language = URL path prefix; `Router.replace`-equivalent on `setConfig.lang`. RTL set `{ar,fa,he}` → `<html dir>`. Dates via native `Intl.DateTimeFormat`/`RelativeTimeFormat` (no lib).

### 7.6 Theming assets

24 built-in themes + `custom_example.css`. A theme = flat block of GitHub Primer CSS vars scoped to `main{}` (`--color-*`, `--color-prettylights-syntax-*`, two giscus extras). `preferred_color_scheme.css` = light vars in `main{}` + dark vars in `@media (prefers-color-scheme: dark) main{}`. Widget component CSS (`base.css`/`globals.css`) consumes the vars; **build with Tailwind v4** (the repo's stack) instead of giscus's Tailwind v3 + postcss chain — port the component classes, drop `important:'#__next'`/`vanillaRTL` specifics as needed.

### 7.7 Math

Port `math-renderer-element.ts` as-is: a `<math-renderer>` custom element lazily importing MathJax 3.2 + DOMPurify (TeX→MathML in an isolated document, sanitize `USE_PROFILES:{mathMl}`, macro caps 100/2000, disallowed-macro list, dimension clamps). Lazy-import once in `Giscus`.

---

## 8. Decisions / divergences from giscus

- **Drop the `/` config-generator demo page** (`pages/index.tsx` + `Configuration.tsx` + README-rendering) from v1 — it's a marketing/onboarding surface, not core. Replace later with a small static "setup" page if wanted. Removes a big chunk of i18n (`config` namespace) and the README-locale machinery.
- **React 19, not Preact.** The alias was only a bundle-size play; with our own build we use real React 19 + `react-dom/server`.
- **`bun:sqlite` only** for the cache — no pluggable backends. (If horizontal scale is ever needed, the cache is a tiny interface; add a Postgres impl then — but a single binary with one SQLite file is the design center.)
- **Proper CORS preflight** (giscus's is incomplete; see §6.1).
- **`BUNCUS_PUBLIC_URL`** instead of trusting proxy headers for the OAuth callback (self-hosted, no Vercel proxy).
- **Consent gate on by default** (§3) — the deliberate behavioral difference from giscus.
- **postMessage namespace** defaults to `buncus` with a `giscus`-compat flag.

---

## 9. Testing (`bun test`)

- **Unit (pure, no network):** `encryption.ts` round-trip + tamper/expiry; `state.ts` TTL; `tokenCache.ts` intolerance-window + created_at preservation (in-memory `:memory:` sqlite); search-query construction (term/strict/category/lowercase); mapping resolution in the loader; `assertOrigin` matrix; adapters (`adaptDiscussion/Comment/Reply`).
- **Contract tests:** given a `<script data-*>`, assert the built iframe URL + params (the §2 contract); postMessage envelope shapes; error-string matching in the loader.
- **Integration (mock GitHub):** use the **`@buncus/mock-github`** subpackage (`packages/mock-github`) — a stateful, dependency-free Bun mock of the GitHub OAuth/REST/GraphQL surfaces, grounded in GitHub's OpenAPI/docs + giscus' actual consumption (see its `SCHEMAS.md`). In-process via `createMockGitHub().fetch(req)` for unit tests, or `.listen(port)` to run the buncus binary against it (set `GITHUB_API_HOST`/`GITHUB_OAUTH_HOST` to its URL). Exercise the OAuth chain, read proxy (user vs App token paths, 403/404/429 mapping), and create-discussion (App token + sha1 marker) entirely offline.
- **e2e (headless Chromium, like present-it's `e2e` tier):** load a page with the loader → **assert zero network egress before consent** (the GDPR invariant) → click consent → iframe loads → resize message sizes the iframe → theme swap works.
- **GraphQL fixtures:** snapshot the exact query strings so a refactor can't silently drift from GitHub's schema.

---

## 10. Phased roadmap

1. **Skeleton + contract:** `Bun.serve` router, embedded static serving, port `loader/buncus.ts` (no consent yet), `/widget` SSR shell rendering a static "hello" — prove the iframe loads and resizes. Headers/cache middleware.
2. **Crypto + OAuth + cache:** `encryption`/`state`, the 3 oauth routes, `bun:sqlite` token cache, App-JWT minting. Sign-in round-trip working end to end.
3. **Reads:** `/api/discussions` (GET) + `/categories`, GraphQL ops + adapters, the SWR hooks, render a real thread (read-only).
4. **Writes:** comment/reply/reaction direct-to-GitHub, optimistic mutators, comment box + markdown preview, math.
5. **Theming + i18n:** port 24 themes + Tailwind v4 widget CSS, locale loader, theme live-swap.
6. **Consent gate (§3):** the headline GDPR layer + its e2e egress test + per-locale `consent.json`.
7. **Compile + harden:** `bun build --compile`, CORS preflight, origin gating, security headers, rate-limit/error-string fidelity, contract test suite green.
8. **Drop-in verification:** swap a real giscus embed to buncus by changing only the script `src`; confirm parity.

---

## 11. Open questions (decide before coding)

- **postMessage namespace:** ship `buncus` default + `giscus` compat, or just `giscus` for max drop-in? (Leaning: `buncus` default, `compat` flag.)
- **Self-hosted GitHub App:** buncus needs its **own** GitHub App (App ID, private key, OAuth client) registered by the operator — document the one-time setup (the SELF-HOSTING.md equivalent). The `giscus.app` App can't be reused.
- **Consent default for `data-consent`:** `required` (strictest) vs `optin-remember`. Leaning `required`.
- **Drop the demo `/` page in v1?** (Leaning yes.)
- **License:** giscus is MIT; buncus can be MIT or MPL-2.0 (matches liebstoeckel). Since we port MIT code, either is fine — keep the giscus MIT NOTICE for the ported portions.
- **Distribution:** just the binary, or also publish the `buncus.js` loader to npm/CDN for non-self-hosters? (A hosted buncus would reintroduce the processor problem — keep it self-host-only by design.)
```
