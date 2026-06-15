// GitHub OAuth code exchange + user-token validation.

import { getConfig } from "../config.ts";

/** Exchange an OAuth code for a GitHub user access token. */
export async function exchangeCodeForToken(code: string, state: string): Promise<string> {
  const { oauthHost, clientId, clientSecret } = getConfig();
  const res = await fetch(`${oauthHost}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "User-Agent": "buncus" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, state }),
  });
  if (!res.ok) throw new Error(`Access token response had status ${res.status}.`);
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || "No access token returned.");
  return data.access_token as string;
}

/** Validate that a user token belongs to this app (giscus' `check`). */
export async function checkToken(token: string): Promise<boolean> {
  const { apiHost, clientId, clientSecret } = getConfig();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  try {
    const res = await fetch(`${apiHost}/applications/${clientId}/token`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Basic ${auth}`, "User-Agent": "buncus" },
      body: JSON.stringify({ access_token: token }),
    });
    const data = await res.json();
    return data?.app?.client_id === clientId;
  } catch {
    return false;
  }
}
