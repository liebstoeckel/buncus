# Migrating from giscus to buncus

buncus is a single-binary, self-hosted host for GitHub Discussions comments. It
keeps giscus' **embed model and `data-*` attributes**, reuses your **existing
GitHub Discussions** with no data migration, but deliberately deviates where
that simplifies running everything from one executable. This document is the
migration path.

## TL;DR

1. Register a GitHub App (you can't reuse giscus.app's — same as self-hosting giscus).
2. Run the `buncus` binary with a handful of env vars.
3. Change your embed `<script src>` from giscus' `client.js` to `https://<your-host>/buncus.js`.
4. Map your giscus `data-theme` to a buncus theme (or point it at a custom CSS URL).
5. Add `data-consent` / `data-privacy-url` if you want the built-in GDPR gate.

Your discussions, mappings, and `data-strict` sha1 markers are unchanged — buncus
talks to the **same GitHub Discussions**.

## What stays the same

- **Backend**: GitHub Discussions. Existing threads created by giscus are found
  and rendered by buncus (same search-by-title / `in:body` sha1 strict marker).
- **`data-*` attributes**: `data-repo`, `data-repo-id`, `data-category`,
  `data-category-id`, `data-mapping` (`pathname｜url｜title｜og:title｜specific｜number`),
  `data-term`, `data-strict`, `data-reactions-enabled`, `data-emit-metadata`,
  `data-input-position`, `data-lang`, `data-loading`, `data-theme`.
- **Mapping semantics**: identical (pathname strips ext, `number` selects by id, …).
- **`<meta name="description">`** and a backlink meta are still read (buncus also
  accepts `<meta name="buncus:backlink">`, falling back to giscus').

## Deliberate deviations (and why)

| Area | giscus | buncus | Why |
|---|---|---|---|
| GitHub traffic | token handed to the browser (`/api/oauth/token`); writes go browser→GitHub | **all GitHub calls proxied server-side**; token never reaches browser JS | fewer moving parts for one binary; the user token is never exposed |
| Session param | `?giscus=` query → `localStorage["giscus-session"]` | `#buncus=` URL **fragment** → `localStorage["buncus-session"]` | own origin; fragment keeps the session out of the query string/Referer |
| postMessage | `{ giscus: … }` | `{ buncus: … }` | namespace independence |
| Token cache | Supabase / PostgREST / Valkey (pick one) | **`bun:sqlite`** (one file) | zero external services |
| Hosting | Next.js on Vercel | **single `bun build --compile` binary** | the whole point |
| GitHub hosts | hard-coded | `GITHUB_API_HOST` / `GITHUB_OAUTH_HOST` configurable | run against a mock / GHES |
| Consent | none | **GDPR gate on by default** (`data-consent`) | EU/DSGVO embedding |
| Themes | 24 built-ins | small set: `light`, `dark`, `preferred_color_scheme` + any custom URL | "small default theme"; custom CSS covers the rest |
| Theme vars | `--color-*` (Primer) | `--bc-*` | smaller, documented surface |
| i18n | ~35 locales | en + de (consent copy); widget strings English | scope; PRs welcome |

None of these change *where comments live* — only how the widget is hosted and wired.

## Step 1 — Register a GitHub App

Exactly as for self-hosting giscus. Create a GitHub App with:

- **Permissions**: Discussions: Read & write; Metadata: Read-only.
- **Callback URL**: `https://<your-host>/api/oauth/authorized`
- **Request user authorization (OAuth) during installation**: on.
- Generate a **private key** (PEM) and an **OAuth client secret**.
- Install the App on the repo(s) that hold your discussions.

(If you already self-hosted giscus, you can reuse that App — just add the buncus
callback URL.)

## Step 2 — Run the binary

```sh
GITHUB_APP_ID=123456 \
GITHUB_CLIENT_ID=Iv1.xxxxxxxx \
GITHUB_CLIENT_SECRET=xxxxxxxx \
GITHUB_PRIVATE_KEY="$(cat your-app.private-key.pem)" \
ENCRYPTION_PASSWORD="$(openssl rand -hex 32)" \
BUNCUS_PUBLIC_URL="https://comments.example.com" \
BUNCUS_DB=/var/lib/buncus/buncus.sqlite \
PORT=4600 \
./buncus
```

`GITHUB_API_HOST` / `GITHUB_OAUTH_HOST` default to GitHub; override for GHES or
the test mock.

## Step 3 — Swap the embed script

**Before (giscus):**
```html
<script src="https://giscus.app/client.js"
        data-repo="acme/docs" data-repo-id="R_…"
        data-category="General" data-category-id="DIC_…"
        data-mapping="pathname" data-theme="dark" crossorigin="anonymous" async>
</script>
```

**After (buncus):**
```html
<script src="https://comments.example.com/buncus.js"
        data-repo="acme/docs" data-repo-id="R_…"
        data-category="General" data-category-id="DIC_…"
        data-mapping="pathname" data-theme="dark"
        data-consent="required" data-privacy-url="/datenschutz" crossorigin="anonymous" async>
</script>
```

Only the `src` (and optional consent attrs) change.

## Step 4 — Theme mapping

buncus ships `light`, `dark`, and `preferred_color_scheme`. Map your giscus theme:

| giscus `data-theme` | buncus `data-theme` |
|---|---|
| `light`, `light_high_contrast`, `light_*`, `noborder_light` | `light` |
| `dark`, `dark_dimmed`, `dark_*`, `transparent_dark`, `noborder_dark` | `dark` |
| `preferred_color_scheme` | `preferred_color_scheme` (default) |
| any other / custom | a custom CSS URL (`data-theme="https://…/my.css"`) |

To reproduce a specific giscus theme exactly, host its CSS (remapping the
`--color-*` variables to buncus' `--bc-*`, or just override the `.bc-*` classes)
and pass its URL as `data-theme`. See `assets/themes/light.css` for the variable
list.

## Step 5 (optional) — GDPR consent gate

With `data-consent="required"` (the default), **no request reaches GitHub until
the visitor clicks "Load comments"** — the iframe isn't injected before consent.
`data-consent="skip"` restores giscus-like immediate loading. `data-privacy-url`
adds a link to your privacy policy in the notice. Copy is English, or German when
`data-lang`/`data-consent-lang` starts with `de`; override with `data-consent-text`.

## What does NOT carry over

- **Sessions**: users signed into giscus will sign in once on buncus (different
  origin + keys). No action needed; the sign-in button handles it.
- **giscus.json origin allowlist**: buncus gates the OAuth redirect, the `/api/*`
  surface, **and** framing (CSP `frame-ancestors`) via the `ORIGINS` env rather
  than a per-repo `giscus.json`. **Cross-origin embedding now requires `ORIGINS`**
  to list your embedding site(s): an empty/unset allowlist permits **same-origin
  only** (buncus itself) — a deliberately secure default. Patterns in
  `ORIGINS_REGEX` must be anchored (e.g. `^https://site\.example$`), since they
  are matched unanchored.
