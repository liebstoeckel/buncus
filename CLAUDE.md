# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

buncus is a single self-contained Bun binary that hosts GitHub Discussions comments on a site: a self-hostable reimplementation of [giscus](https://github.com/giscus/giscus). It is a Bun workspace with two packages:

- `packages/buncus` — the server, the embed loader, the React widget, themes, the demo, and tests.
- `packages/mock-github` — a stateful, dependency-free mock of GitHub's OAuth/REST/GraphQL surfaces. Everything builds and tests against it, so **no GitHub access is needed for development**.

## Commands

Run from the repo root unless noted. The local quality gate is `check` + `typecheck` + `test`; all three must be green (CI runs the same in `.github/workflows/ci.yml`).

```sh
bun install
bun run check                              # Biome lint + format check (read-only gate)
bun run check:fix                          # apply Biome fixes (formatting, imports, safe lint)
bun run typecheck                          # tsc --noEmit (typescript is a devDep, tsc 6.x)
bun test packages                          # full suite, all offline via @liebstoeckel/buncus-mock-github

bun run --cwd packages/buncus compile      # build:assets + bun build --compile -> dist/buncus
bun run --cwd packages/buncus dev          # hot-reload dev server (run build:assets first)
bun run --cwd packages/buncus demo         # live demo: mock + binary + host page (ports 4699/4655/4700)
bun run --cwd packages/buncus test:e2e     # just the Playwright e2e
```

Running a single test (bun's `test` takes a path and `-t` name filter):

```sh
bun test packages/buncus/test/crypto.test.ts          # one file
bun test packages -t "decrypt"                         # by test-name pattern
```

Gotchas:
- `compile` runs `build:assets` first because the server imports the bundled loader/widget/CSS via `with { type: "file" }`; without that step the asset routes fail to import. Same applies before `dev`, `test`, and e2e.
- The e2e suite drives real headless Chromium and **skips cleanly if no Playwright browser is installed** (`bunx playwright install chromium` to enable it).
- The demo defaults to `localhost`. To view it from a remote browser, set `DEMO_HOST=<machine-ip>` so the loader URL, public URL, and `ORIGINS` allowlist all agree, or the hardened origin checks reject the cross-origin embed.
- Production boot **throws** unless the required secrets are set; use `BUNCUS_MOCK=1` for local/testing to relax that and use mock defaults.

## Architecture (the big picture)

The system has three actors with two trust boundaries (see `ARCHITECTURE.md` §2): the embedding page, the buncus binary, and GitHub. The browser **never** talks to GitHub directly, and the GitHub token never leaves the server.

**Two halves communicating over `postMessage`.** The *loader* (`packages/buncus/loader/boot.ts`) runs on the host page: it renders the consent gate and, on consent, injects an `<iframe>` pointing at `/widget`. The *widget* (`packages/buncus/src/client/`, React 19) runs inside that iframe and fetches `/api/*` same-origin. They only exchange `{ buncus: ... }` messages (resize, sign-out, config). This iframe is the first trust boundary.

**The server is a proxy.** `src/server.ts` routes: embedded static assets (`/buncus.js`, CSS, themes), the `/widget` HTML shell (with a tight CSP), the `/api/*` proxy, and `/healthz`. All GitHub-facing calls go through `src/github/` (`graphql.ts`, `appToken.ts`, `jwt.ts`, `adapters.ts`). Anonymous reads use the GitHub App installation token (minted via JWT, cached in `bun:sqlite` by `src/cache/tokenCache.ts`); signed-in reads and all writes use the user's token. This is the second trust boundary (`buncus <-> GitHub`).

**Sessions are header-based, not cookies.** OAuth returns the user token encrypted into a session (`src/crypto/` — scrypt KDF + AES-GCM) delivered to the page in the URL **fragment** (`#buncus=`), stored in `localStorage`, and replayed in the `x-buncus-session` header. Using a header (not a cookie) makes write requests CSRF-resistant by construction.

**`ORIGINS` is the central security control.** `isAllowedOrigin` in `src/config.ts` gates the OAuth redirect, the `/api/*` surface, and the framing CSP `frame-ancestors`. An empty `ORIGINS` means same-origin only; cross-origin embedding requires listing the embedding site(s).

**GraphQL queries are ported verbatim from giscus** (`src/github/graphql.ts`). Comment bodies are GitHub-rendered `bodyHTML` injected via `dangerouslySetInnerHTML` in `src/client/components/Comment.tsx` — trusted because GitHub sanitizes server-side, with the widget CSP (`script-src 'self'`) as defense-in-depth. There is a `biome-ignore` on that line documenting the trust model.

The canonical references are `ARCHITECTURE.md` (as-built design + decision log), `packages/buncus/README.md` (operator usage, env vars, embed attributes), `packages/buncus/MIGRATION.md` (giscus → buncus), and `packages/mock-github/SCHEMAS.md` (how the mock's shapes map to GitHub).

## Conventions

- **Biome** (`biome.json`) is the formatter/linter: 2-space indent, double quotes, semicolons, line width 120. `noNonNullAssertion` and `noExplicitAny` are intentionally **off** — this codebase uses non-null assertions deliberately, so prefer `x!.y` over restructuring when a value is known-present (especially in tests). HTML files are excluded from Biome (its parser chokes on the demo's `{{theme}}` template).
- Keep the neutral, terse documentation voice; the prose docs avoid em dashes.

## Do not commit

- `.claude/` — Claude Code session state and git worktrees (gitignored).
- `giscus-eval/` — a local reference clone of giscus for comparison (gitignored).
