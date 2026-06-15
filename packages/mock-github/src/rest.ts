// REST handlers for the api.github.com surface buncus/giscus depend on.
// Response shapes follow GitHub's documented schemas + OpenAPI (see SCHEMAS.md);
// only fields buncus reads are guaranteed-meaningful, the rest are realistic
// filler so the objects look like the real thing.

import { Store } from "./store.ts";
import { renderMarkdown } from "./markdown.ts";

export type Result = {
  status: number;
  json?: unknown;
  text?: string;
  contentType?: string;
  /** When set, the router emits a redirect with this Location header. */
  location?: string;
};

function notFound(): Result {
  return {
    status: 404,
    json: {
      message: "Not Found",
      documentation_url: "https://docs.github.com/rest",
    },
  };
}

/** GET /repos/{owner}/{repo}/installation  (Bearer = App JWT) */
export function getRepoInstallation(store: Store, owner: string, repo: string): Result {
  const r = store.getRepo(`${owner}/${repo}`);
  if (!r) return notFound();
  const account = store.users.get(store.appUserId)!;
  return {
    status: 200,
    json: {
      id: r.installationId,
      account: { login: owner, id: 1, type: "Organization" },
      access_tokens_url: `https://api.github.com/app/installations/${r.installationId}/access_tokens`,
      repositories_url: "https://api.github.com/installation/repositories",
      html_url: `https://github.com/organizations/${owner}/settings/installations/${r.installationId}`,
      app_id: Number(store.appId),
      app_slug: "buncus",
      target_id: 1,
      target_type: "Organization",
      permissions: { discussions: "write", metadata: "read" },
      events: [],
      created_at: store.now(),
      updated_at: store.now(),
      single_file_name: null,
      repository_selection: "selected",
      suspended_by: null,
      suspended_at: null,
      account_avatar: account.avatarUrl,
    },
  };
}

/** POST /app/installations/{installation_id}/access_tokens  (Bearer = App JWT) */
export function createInstallationToken(store: Store, installationId: number): Result {
  const repo = store.getRepoByInstallationId(installationId);
  if (!repo) return notFound();
  const { token, expires_at } = store.issueInstallationToken(installationId);
  return {
    status: 201,
    json: {
      token,
      expires_at,
      permissions: { discussions: "write", metadata: "read" },
      repository_selection: "selected",
    },
  };
}

/** POST /applications/{client_id}/token  (Basic client_id:client_secret) — validate a user token. */
export function checkToken(store: Store, clientId: string, accessToken: string): Result {
  const user = store.userForToken(accessToken);
  if (clientId !== store.clientId || !user || user.isApp) {
    // GitHub returns 422 for an unknown token under a valid app.
    return { status: 422, json: { message: "Unprocessable Entity", documentation_url: "https://docs.github.com/rest" } };
  }
  return {
    status: 200,
    json: {
      id: 1,
      url: `https://api.github.com/authorizations/1`,
      scopes: [],
      token: accessToken,
      token_last_eight: accessToken.slice(-8),
      hashed_token: null,
      app: {
        url: "https://github.com/apps/buncus",
        name: "buncus",
        client_id: store.clientId,
      },
      note: null,
      note_url: null,
      created_at: store.now(),
      updated_at: store.now(),
      expires_at: null,
      user: { login: user.login, id: 1, avatar_url: user.avatarUrl, html_url: user.url, type: "User" },
    },
  };
}

/** GET /repos/{owner}/{repo}/contents/{path} — used to read giscus.json. */
export function getContents(store: Store, owner: string, repo: string, path: string): Result {
  const r = store.getRepo(`${owner}/${repo}`);
  if (!r) return notFound();
  if (path === "giscus.json" && r.config != null) {
    const raw = JSON.stringify(r.config, null, 2);
    const content = Buffer.from(raw).toString("base64");
    return {
      status: 200,
      json: {
        name: "giscus.json",
        path: "giscus.json",
        sha: "0".repeat(40),
        size: raw.length,
        url: `https://api.github.com/repos/${owner}/${repo}/contents/giscus.json`,
        html_url: `https://github.com/${owner}/${repo}/blob/main/giscus.json`,
        git_url: `https://api.github.com/repos/${owner}/${repo}/git/blobs/${"0".repeat(40)}`,
        download_url: `https://raw.githubusercontent.com/${owner}/${repo}/main/giscus.json`,
        type: "file",
        content: content.match(/.{1,60}/g)?.join("\n") + "\n",
        encoding: "base64",
        _links: {
          self: `https://api.github.com/repos/${owner}/${repo}/contents/giscus.json`,
          git: `https://api.github.com/repos/${owner}/${repo}/git/blobs/${"0".repeat(40)}`,
          html: `https://github.com/${owner}/${repo}/blob/main/giscus.json`,
        },
      },
    };
  }
  return notFound();
}

/** POST /markdown — render GFM to HTML (returns text/html, like GitHub). */
export async function postMarkdown(body: { text?: string }): Promise<Result> {
  return { status: 200, contentType: "text/html; charset=utf-8", text: renderMarkdown(body.text ?? "") };
}
