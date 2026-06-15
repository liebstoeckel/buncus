// GitHub OAuth web application flow.
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
//
//   1. GET  /login/oauth/authorize?client_id&redirect_uri&state
//      -> (real GitHub shows a consent screen) -> 302 redirect_uri?code&state
//   2. POST /login/oauth/access_token  {client_id, client_secret, code}
//      -> { access_token, token_type: "bearer", scope } (Accept: application/json)
//
// The mock auto-approves by default so automated flows work headlessly. Pass
// ?mock_error=access_denied to simulate the user clicking "Cancel",
// ?mock_interactive=1 to render a clickable consent page instead, and
// ?mock_user=<login> to authenticate as a specific seeded user (defaults to the
// store viewer) — the basis for multi-user e2e scenarios.

import { Store } from "./store.ts";
import type { Result } from "./rest.ts";

export function authorize(store: Store, url: URL): Result {
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const simulateError = url.searchParams.get("mock_error");
  const interactive = url.searchParams.get("mock_interactive");
  const mockUser = url.searchParams.get("mock_user");

  if (clientId !== store.clientId) {
    return { status: 400, json: { error: "incorrect_client_credentials" } };
  }
  if (!redirectUri) {
    return { status: 400, json: { error: "redirect_uri_required" } };
  }

  // Resolve which user signs in: `mock_user` (by login) or the default viewer.
  let userId = store.viewerUserId;
  if (mockUser) {
    const user = store.userByLogin(mockUser);
    if (!user) {
      return { status: 400, json: { error: "unknown_mock_user", error_description: `No mock user with login "${mockUser}".` } };
    }
    userId = user.id;
  }

  const back = new URL(redirectUri);
  if (state) back.searchParams.set("state", state);

  if (simulateError) {
    back.searchParams.set("error", simulateError);
    return redirect(back.href);
  }

  if (interactive) {
    const code = store.issueOAuthCode(userId);
    const approve = new URL(redirectUri);
    if (state) approve.searchParams.set("state", state);
    approve.searchParams.set("code", code);
    const deny = new URL(back.href);
    deny.searchParams.set("error", "access_denied");
    return {
      status: 200,
      contentType: "text/html; charset=utf-8",
      text: consentPage(store, userId, approve.href, deny.href),
    };
  }

  // Auto-approve.
  const code = store.issueOAuthCode(userId);
  back.searchParams.set("code", code);
  return redirect(back.href);
}

export async function accessToken(store: Store, params: URLSearchParams): Promise<Result> {
  const clientId = params.get("client_id");
  const clientSecret = params.get("client_secret");
  const code = params.get("code") ?? "";

  if (clientId !== store.clientId || clientSecret !== store.clientSecret) {
    // GitHub returns HTTP 200 with an error body for the OAuth token endpoint.
    return {
      status: 200,
      json: {
        error: "incorrect_client_credentials",
        error_description: "The client_id and/or client_secret passed are incorrect.",
        error_uri: "https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/",
      },
    };
  }

  const result = store.exchangeCode(code);
  if ("error" in result) {
    return {
      status: 200,
      json: {
        error: "bad_verification_code",
        error_description: "The code passed is incorrect or expired.",
        error_uri: "https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/",
      },
    };
  }

  return { status: 200, json: { access_token: result.access_token, token_type: "bearer", scope: "" } };
}

function redirect(location: string): Result {
  return { status: 302, location };
}

function consentPage(store: Store, userId: string, approveUrl: string, denyUrl: string): string {
  const user = store.users.get(userId)!;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Authorize buncus (mock)</title></head>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto">
  <h1>Mock GitHub — Authorize</h1>
  <p>Sign in as <strong>${user.login}</strong> and authorize <strong>buncus</strong>?</p>
  <p><a href="${approveUrl}"><button>Authorize</button></a>
     <a href="${denyUrl}"><button>Cancel</button></a></p>
</body></html>`;
}
