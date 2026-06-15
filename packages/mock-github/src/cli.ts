#!/usr/bin/env bun
// Standalone runner: `bun run packages/mock-github/src/cli.ts [--port 4500]`
// Prints the base URL + the credentials/seed buncus should be configured with.

import { createMockGitHub } from "./index.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = Bun.argv.indexOf(`--${name}`);
  return i >= 0 ? Bun.argv[i + 1] : (process.env[`MOCK_${name.toUpperCase()}`] ?? fallback);
}

const port = Number(arg("port", "4500"));
const clientId = arg("client-id", "Iv1.mockclient0000")!;
const clientSecret = arg("client-secret", "mock_client_secret_value")!;
const appId = arg("app-id", "123456")!;

const mock = createMockGitHub({ clientId, clientSecret, appId }).listen(port);
const repo = [...mock.store.repos.values()][0];
const category = repo.categories[0];

console.log(`
┌─ @liebstoeckel/buncus-mock-github ───────────────────────────────────────────────
│ listening:        ${mock.url}
│
│ Point buncus at this single origin for BOTH hosts:
│   GITHUB_API_HOST=${mock.url}
│   GITHUB_OAUTH_HOST=${mock.url}
│   GITHUB_CLIENT_ID=${clientId}
│   GITHUB_CLIENT_SECRET=${clientSecret}
│   GITHUB_APP_ID=${appId}
│   GITHUB_PRIVATE_KEY=(any PEM — signature is not verified by the mock)
│
│ Seeded repo:      ${repo.nameWithOwner}   (repoId ${repo.id}, installation ${repo.installationId})
│   category:       ${category.name}  (categoryId ${category.id})  ${category.emoji}
│   sign-in as:     ${mock.store.users.get(mock.store.viewerUserId)?.login}
│
│ Try the OAuth flow:
│   ${mock.url}/login/oauth/authorize?client_id=${clientId}&redirect_uri=http://localhost:3000/cb&state=xyz&mock_interactive=1
└─────────────────────────────────────────────────────────────────────
`);

process.on("SIGINT", () => {
  mock.stop();
  process.exit(0);
});
