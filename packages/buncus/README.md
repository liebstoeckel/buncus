# @liebstoeckel/buncus-server (buncus)

A single self-contained binary that hosts [GitHub Discussions](https://docs.github.com/discussions)
comments on your site. It's a Bun-native, themeable, GDPR-by-default reimplementation
of [giscus](https://giscus.app).

> **Status: experimental, pre-1.0.** This is a mostly vibe-coded experiment built
> for internal use cases, and is not production ready. Before 1.0, breaking
> changes can land in any release without a major-version bump, so pin an exact
> version if you depend on it.

> **GDPR.** buncus aims to make it easier to host a GDPR-compliant comment system,
> but does not guarantee that the implementation is compliant as-is. GitHub still
> acts as a third party when comments load. You are responsible for providing a
> privacy document and ensuring your own deployment is compliant.

- Single binary: `bun build --compile`, which embeds the loader, widget, CSS, and themes.
- Themeable: CSS-variable themes (`light` / `dark` / `preferred_color_scheme`) plus any custom CSS URL, with a small default theme included.
- GDPR-by-default: nothing touches GitHub until the visitor opts in (a consent toggle gates the iframe before it's inlined).
- Token-safe: all GitHub traffic is proxied server-side, so the GitHub token never reaches browser JS.
- Bun everything: `Bun.serve`, `bun:sqlite`, native `crypto.subtle`, `bun test`, React 19.

> Coming from giscus? See [`MIGRATION.md`](./MIGRATION.md). It's mostly a one-line
> `<script src>` swap. Design rationale is in the repo-root [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

## Quick start

```sh
# 1. Build the embedded assets + compile the binary
bun run build:assets
bun run compile          # -> dist/buncus

# 2. Run it (see env below)
GITHUB_APP_ID=… GITHUB_CLIENT_ID=… GITHUB_CLIENT_SECRET=… \
GITHUB_PRIVATE_KEY="$(cat app.pem)" ENCRYPTION_PASSWORD="$(openssl rand -hex 32)" \
BUNCUS_PUBLIC_URL="https://comments.example.com" BUNCUS_DB=/var/lib/buncus.sqlite \
./dist/buncus
```

Embed on any page:

```html
<script src="https://comments.example.com/buncus.js"
        data-repo="acme/docs" data-repo-id="R_…"
        data-category="General" data-category-id="DIC_…"
        data-mapping="pathname" data-theme="preferred_color_scheme"
        data-consent="required" data-privacy-url="/datenschutz" crossorigin="anonymous" async>
</script>
```

(You need a GitHub App. See [`MIGRATION.md` §Step 1](./MIGRATION.md#step-1--register-a-github-app).)

## Environment

| Var | Required | Default | Meaning |
|---|---|---|---|
| `GITHUB_APP_ID` | ✓ |  | GitHub App id (JWT issuer) |
| `GITHUB_CLIENT_ID` | ✓ |  | OAuth client id |
| `GITHUB_CLIENT_SECRET` | ✓ |  | OAuth client secret |
| `GITHUB_PRIVATE_KEY` | ✓ |  | App private key (PEM; `\n`-escaped ok) |
| `ENCRYPTION_PASSWORD` | ✓ |  | master key for the session box (AES-GCM) |
| `BUNCUS_PUBLIC_URL` | recommended | `http://localhost:$PORT` | buncus' own base URL (OAuth callback) |
| `BUNCUS_DB` | | `:memory:` | SQLite path for the token cache |
| `PORT` | | `4600` | listen port |
| `GITHUB_API_HOST` | | `https://api.github.com` | REST/GraphQL base (GHES / mock) |
| `GITHUB_OAUTH_HOST` | | `https://github.com` | OAuth base (GHES / mock) |
| `ORIGINS` | for cross-origin embeds | `[]` | JSON array of embedding origins. Gates the OAuth redirect, the API, and framing. Empty means same-origin only, so a cross-origin site embedding buncus must be listed here. |
| `ORIGINS_REGEX` | | `[]` | JSON array of origin regexes (same purpose as `ORIGINS`). |
| `THEME_ORIGINS` | | `[]` | JSON array of origins allowed to serve external custom theme CSS. These origins also widen the widget CSP `font-src` (alongside `'self'` and `data:`), so a theme served from an allowlisted origin can load a webfont from it. The font response must send `Access-Control-Allow-Origin` for the cross-origin fetch. |
| `SESSION_TTL_DAYS` | | `30` | Session lifetime. |
| `GITHUB_WEBHOOK_SECRET` | |  | If set, `/api/webhook` verifies the GitHub HMAC. |
| `BUNCUS_MOCK` | |  | `1` relaxes secret validation and uses mock defaults (local/testing only). |

> Security: required secrets must be set in production. The binary refuses to boot otherwise, and it rejects the known dev password. `ORIGINS` is the allowlist for the OAuth redirect, the API, and framing; set it to your embedding site(s). The hardening is regression-tested in `test/security.test.ts`.

## Embed attributes

giscus-compatible: `data-repo`, `data-repo-id`, `data-category`, `data-category-id`,
`data-mapping` (`pathname｜url｜title｜og:title｜specific｜number`), `data-term`,
`data-strict`, `data-reactions-enabled`, `data-emit-metadata`, `data-input-position`,
`data-theme`, `data-lang`, `data-loading`.

buncus-only: `data-consent` (`required` default ｜ `skip`), `data-privacy-url`,
`data-consent-text`, `data-consent-lang`.

## Theming

A theme is a CSS file that sets `--bc-*` variables (see `assets/themes/light.css`
for the full list). Built-ins are served at `/themes/<name>.css`. To use your own:

```html
data-theme="https://your.site/buncus-theme.css"
```

The widget loads the theme into `<link id="buncus-theme">`, and a parent page can swap
it at runtime by posting `{ buncus: { setConfig: { theme } } }` to the iframe.
Add a built-in by dropping a CSS file in `assets/themes/` and registering it in
`src/routes/assets.ts` (`BUILTIN_THEMES` plus the asset map).

## How it fits together

```
buncus.js (loader)  → consent gate → <iframe src="/widget?…">
                                          widget.js (React 19)  → /api/* (same origin)
/api/* (proxy)      → GitHub GraphQL/REST   (token stays server-side)
bun:sqlite          ← App installation-token cache
```

- Reads (thread, categories): anonymous requests use the App installation token; signed-in requests use the user token.
- Pagination: comments load giscus-style front/back. The newest page is pinned and an oldest-first stream grows from a "load more" button (15 per page), with an oldest/newest order toggle. Each "load more" is one extra GraphQL read on the same token bucket, so on a single-repo self-host (App token ≈ 5,000 points/hr shared across anonymous readers) very high-traffic threads can hit the 429 that prompts visitors to sign in.
- Writes (comment, reply, reaction): require a signed-in session and run server-side.
- OAuth: `/api/oauth/authorize` → GitHub → `/api/oauth/authorized`, then the encrypted session is returned to the page in the URL fragment (`#buncus=`, validated against the `ORIGINS` allowlist), never the query string.

## Development

```sh
bun run build:assets         # bundle loader + widget
bun --hot src/server.ts      # dev server (after build:assets)
bun test                     # unit + integration + e2e (uses @liebstoeckel/buncus-mock-github, no GitHub needed)
bun run test:e2e             # just the Playwright browser e2e
bunx tsc --noEmit            # typecheck (from repo root)
bun run scripts/smoke.ts     # smoke-test the compiled binary against the mock
bun run scripts/screenshot.ts# render widget screenshots to dist/shots/
bun run demo                 # live demo: mock + binary + host page (ports 4699/4655/4700)
```

The demo defaults to `localhost`. When viewing from a remote browser, set
`DEMO_HOST` to this machine's IP (from `ip a`) so the loader URL, the public URL, and
the `ORIGINS` allowlist all agree. Otherwise the post-hardening origin checks
reject the cross-origin embed:

```sh
DEMO_HOST=192.0.2.10 bun run demo      # then open http://192.0.2.10:4700/
```

All tests run against [`@liebstoeckel/buncus-mock-github`](../mock-github), so no GitHub access is required.

Test tiers:
- unit: crypto (AES-GCM box, state TTL), `bun:sqlite` token cache, loader param/mapping/consent logic.
- integration: the proxied API and the server routes driven against the in-process mock (the OAuth dance, then create → comment → reply → react → read-back).
- render: widget React components via `react-dom/server`.
- pagination: the pure front/back merge (overlap dedup, hidden-gap count, newest-order swap) plus end-to-end cursor paging through the proxy (`test/pagination.test.ts`).
- loader DOM: the consent gate and iframe injection under happy-dom.
- e2e: Playwright with real headless Chromium, going from demo page → consent gate → widget iframe → seeded discussion → OAuth sign-in → post a comment → "load more" pagination → theme check (`test/e2e/widget.e2e.test.ts`).

> e2e note: the test uses `chromium.launch({ channel: "chromium" })`, the full Chromium build. In some sandboxes the lighter `chrome-headless-shell` segfaults while the full build runs fine. The suite skips cleanly if no Playwright browser is installed. Install once with `bunx playwright install chromium`.

## License & attribution

buncus is [MIT licensed](../../LICENSE).

It is a reimplementation of [giscus](https://github.com/giscus/giscus) by
Sage M. Abdullah and contributors, and it reuses code from giscus: the GitHub
GraphQL queries, parts of the client/proxy architecture, and the `data-*` embed
model. giscus is MIT licensed, and its notice is reproduced in [`LICENSE`](../../LICENSE).
