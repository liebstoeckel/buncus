# Grounding: which GitHub surfaces this mock reproduces, and from where

This mock is **not** invented. Every endpoint mirrors a real GitHub API
operation, and every response shape is taken from one of:

1. **GitHub's published OpenAPI description** — `github/rest-api-description`
   (`descriptions/api.github.com/api.github.com.json`), the same source that
   powers the REST reference docs.
2. **GitHub's REST/GraphQL reference docs** (linked per endpoint below).
3. **What buncus/giscus actually consume** — `giscus-eval/services/github/*.ts`
   and the response types in `giscus-eval/lib/types/github.ts`. This is the
   authoritative list of *fields that must be present and meaningful*; the mock
   guarantees those and fills the rest with realistic, schema-shaped filler.

The mock serves both GitHub origins on **one** host (path namespaces don't
collide), so buncus points `GITHUB_API_HOST` **and** `GITHUB_OAUTH_HOST` at it.

> Note on fidelity: response objects include the fields buncus reads plus enough
> surrounding fields to look real. They are **not** byte-for-byte GitHub
> payloads. `bodyHTML`/`/markdown` output is plausible HTML, not GitHub's exact
> renderer output — buncus renders whatever HTML it receives, so this is safe.

---

## OAuth web application flow  (host: github.com)

| Mock route | Real operation | Source |
|---|---|---|
| `GET /login/oauth/authorize` | Authorize request | [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#1-request-a-users-github-identity) |
| `POST /login/oauth/access_token` | Exchange code → token | [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#2-users-are-redirected-back-to-your-site-by-github) |

- **authorize**: validates `client_id`, then (default) auto-approves and
  `302`s to `redirect_uri?code=…&state=…`. `?mock_error=access_denied`
  simulates the user cancelling; `?mock_interactive=1` renders a consent page.
  Real GitHub redirects with `code` (10-min TTL) + the round-tripped `state`.
- **access_token**: with `Accept: application/json`, returns
  `{ access_token, token_type: "bearer", scope }`. **GitHub returns HTTP 200
  with an error body** (`{ error, error_description, error_uri }`) for
  `bad_verification_code` / `incorrect_client_credentials` — the mock matches
  this (it does *not* use a 4xx status), which is exactly what giscus'
  `authorized.ts` relies on (`response.ok` true, `data.access_token` absent).

Consumed by giscus: `giscus-eval/pages/api/oauth/authorize.ts`,
`pages/api/oauth/authorized.ts` (reads only `data.access_token`).

---

## REST  (host: api.github.com)

| Mock route | Real operation | Doc / OpenAPI operationId | buncus reads |
|---|---|---|---|
| `GET /repos/{owner}/{repo}/installation` | Get a repository installation for the authenticated app | `apps/get-repo-installation` · [docs](https://docs.github.com/en/rest/apps/apps#get-a-repository-installation-for-the-authenticated-app) | `id` |
| `POST /app/installations/{installation_id}/access_tokens` | Create an installation access token | `apps/create-installation-access-token` · [docs](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app) | `token`, `expires_at` |
| `POST /applications/{client_id}/token` | Check a token | `apps/check-token` · [docs](https://docs.github.com/en/rest/apps/oauth-applications#check-a-token) | `app.client_id` |
| `GET /repos/{owner}/{repo}/contents/{path}` | Get repository content | `repos/get-content` · [docs](https://docs.github.com/en/rest/repos/contents#get-repository-content) | `content` (base64), `message` (404) |
| `POST /markdown` | Render a Markdown document | `markdown/render` · [docs](https://docs.github.com/en/rest/markdown/markdown#render-a-markdown-document) | response body (HTML text) |

Details that matter for compatibility:

- **installation**: real schema is the *installation* object (shared with "Get an
  installation for the authenticated app"). giscus' `getInstallationId` reads
  only `id`; the mock returns the full object anyway (`account`, `app_id`,
  `permissions`, `repository_selection`, …). Unknown repo → `404`, which giscus
  treats as "giscus is not installed on this repository".
- **access_tokens**: real status is **`201`** with
  `{ token, expires_at, permissions, repository_selection }`. giscus reads
  `token` + `expires_at` and caches them (see the `bun:sqlite` token cache in
  the buncus SPEC). Tokens last 1h (mirrored).
- **check-token**: authenticated with **Basic `base64(client_id:client_secret)`**
  and body `{ access_token }`. giscus validates `data.app.client_id === client_id`
  (`services/github/oauth.ts`). Mock returns the *authorization* object
  (`id, url, scopes, token, app{client_id,name,url}, user{…}, …`); unknown token
  → `422` (GitHub's response for a valid app + unknown token).
- **contents**: giscus reads `giscus.json` via `getFile.ts` and does
  `Buffer.from(content, "base64").toString()`, so the mock returns `type:"file"`,
  `encoding:"base64"`, and a newline-wrapped base64 `content` (GitHub wraps at
  60 chars). Missing file → `404` with a `message`, which giscus swallows
  (`getRepoConfig` returns `{}`).
- **markdown**: returns `text/html`. giscus calls this for the compose-box
  preview (`renderMarkdown`, browser-side).

---

## GraphQL  (host: api.github.com, `POST /graphql`)

One endpoint, dispatched by matching the operation in the query string +
variables (giscus' queries are fixed strings — see
`giscus-eval/services/github/*.ts`). Reference:
[GitHub GraphQL API](https://docs.github.com/en/graphql) ·
[Discussion object](https://docs.github.com/en/graphql/reference/objects#discussion) ·
[Mutations](https://docs.github.com/en/graphql/reference/mutations).

| Operation | giscus file | Notes |
|---|---|---|
| `search(type: DISCUSSION last: 1)` + `viewer` | `getDiscussion.ts` | term mode; `in:title` (fuzzy) or `in:body` (strict, sha1 marker) |
| `repository.discussion(number:)` + `viewer` | `getDiscussion.ts` | number mode |
| `search(type: REPOSITORY first: 1)` | `getDiscussionCategories.ts` | returns `discussionCategories(first:100)` with `emojiHTML` |
| `createDiscussion(input:)` | `createDiscussion.ts` | returns `{ discussion { id } }` |
| `addDiscussionComment(input:)` | `addDiscussionComment.ts` | returns full comment selection set |
| `addDiscussionReply: addDiscussionComment(… replyToId)` | `addDiscussionReply.ts` | aliased; returns reply with `replyTo.id` |
| `addReaction` / `removeReaction` (aliased `toggleReaction`) | `toggleReaction.ts` | `ReactionContent` ∈ the 8 giscus reactions |
| `addUpvote` / `removeUpvote` (aliased `toggleUpvote`) | `toggleUpvote.ts` | returns `subject.upvoteCount` |

Projection rules (so giscus' adapters in `lib/adapter.ts` work unchanged):

- **`reactionGroups`** always returns a group for **all 8** `ReactionContent`
  values (`THUMBS_UP, THUMBS_DOWN, LAUGH, HOORAY, CONFUSED, HEART, ROCKET, EYES`)
  with `{ users { totalCount }, viewerHasReacted }` — matching GitHub and keeping
  `adaptReactionGroups`/`updateReactionGroups` total.
- **`viewer`** is derived from the bearer token: a user OAuth token → that user;
  an installation token → the App bot identity (anonymous reads). `null` author
  is left for giscus' `GhostUser` fallback to handle.
- **`comments(first/last/after/before)`** is real cursor pagination
  (base64 index cursors, correct `pageInfo`) so the front/back dual-load and
  "load more" in giscus' `useFrontBackDiscussion` behave.
- **discussion search** parses `repo:`, `category:"…"`, `in:title|in:body`, and
  the quoted term out of the query string giscus builds, then matches stored
  discussions (title for fuzzy, body-contains for the strict sha1 marker).

---

## What is intentionally NOT modelled

- Rate-limiting / `API rate limit exceeded` (buncus maps it to `429`; can be
  added as a store toggle later for testing that path).
- Real GraphQL schema validation / arbitrary queries (only giscus' fixed
  operation set is recognised).
- Real JWT signature verification on the App JWT (the mock accepts any Bearer on
  the app endpoints — there's nothing to verify against without GitHub).
- Pagination of replies (`replies(last:100)` returns up to 100, unpaginated).
