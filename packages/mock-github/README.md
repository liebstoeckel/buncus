# @buncus/mock-github

A dependency-free, **stateful** mock of the GitHub surfaces that buncus (and
giscus) depend on, so the rest of buncus can be built and tested **without any
GitHub access**. Pure Bun — `Bun.serve`, web `fetch`, no npm deps.

It reproduces three surfaces on **one origin**:

- **OAuth web flow** — `/login/oauth/authorize`, `/login/oauth/access_token`
- **REST** — repo installation, installation access tokens, check-token,
  repo contents (`giscus.json`), markdown
- **GraphQL Discussions** — search/get discussions, categories, create
  discussion, add comment/reply, toggle reaction/upvote

State is in-memory and persists for the instance's lifetime, so a client can
create a discussion → comment → reply → react → **read it back**. Shapes are
grounded in GitHub's OpenAPI/docs and in what buncus actually consumes — see
[`SCHEMAS.md`](./SCHEMAS.md).

## Use it in tests (in-process, no port)

```ts
import { createMockGitHub, resetIds } from "@buncus/mock-github";

resetIds();                          // deterministic node IDs
const mock = createMockGitHub();     // seeds repo acme/docs + dev user + bot

const res = await mock.fetch(new Request("http://gh/graphql", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer <token>" },
  body: JSON.stringify({ query, variables }),
}));

// drive/inspect state directly:
mock.store.addRepo("me/blog", { categories: [{ name: "General", emoji: "💬" }] });
```

## Run it as a server (for the buncus binary / browser)

```sh
bun run packages/mock-github/src/cli.ts --port 4500
# or from the workspace root:
bun run mock -- --port 4500
```

Then point buncus at the single origin for **both** hosts:

```sh
GITHUB_API_HOST=http://localhost:4500
GITHUB_OAUTH_HOST=http://localhost:4500
GITHUB_CLIENT_ID=Iv1.mockclient0000
GITHUB_CLIENT_SECRET=mock_client_secret_value
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY=<any PEM — signature is not verified by the mock>
```

> This requires buncus to make its GitHub base URLs configurable (the SPEC notes
> this: `GITHUB_API_HOST` / `GITHUB_OAUTH_HOST` — giscus hard-codes them). That's
> the one buncus-side change the mock assumes.

## Seed (defaults)

| Thing | Value |
|---|---|
| Repo | `acme/docs` (installation id `42`) |
| Categories | `General` 💬, `Announcements` 📣 |
| Sign-in user | `dev` |
| App bot | `buncus[bot]` |
| Client id / secret | `Iv1.mockclient0000` / `mock_client_secret_value` |

Override via `createMockGitHub({ clientId, clientSecret, appId, now })` or the
CLI flags `--client-id`, `--client-secret`, `--app-id`, `--port`.

## Knobs

- `?mock_error=access_denied` on `/login/oauth/authorize` → simulate the user
  cancelling.
- `?mock_interactive=1` → render a clickable consent page instead of
  auto-approving.
- `?mock_user=<login>` on `/login/oauth/authorize` → authenticate as a specific
  seeded user instead of the default viewer (the basis for multi-user flows;
  unknown logins are rejected with `unknown_mock_user`).
- `mock.store` is the live state — seed before a flow, assert after. Add users
  with `store.addUser(...)` and select the OAuth viewer with `store.viewerUserId`.

## Tests

```sh
bun test packages/mock-github
```
