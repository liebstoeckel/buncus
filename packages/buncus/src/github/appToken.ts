// Mint (and cache) GitHub App installation access tokens for anonymous reads
// and app-authored discussion creation. Ported from giscus' getAppAccessToken.

import type { TokenCache } from "../cache/tokenCache.ts";
import { getConfig } from "../config.ts";
import { signAppJwt } from "./jwt.ts";

function appHeaders(): HeadersInit {
  const { appId, privateKey } = getConfig();
  return {
    Authorization: `Bearer ${signAppJwt(appId, privateKey)}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "buncus",
  };
}

async function getInstallationId(repoWithOwner: string): Promise<number | undefined> {
  const { apiHost } = getConfig();
  const res = await fetch(`${apiHost}/repos/${repoWithOwner}/installation`, { headers: appHeaders() });
  if (!res.ok) return undefined;
  const data = await res.json();
  return data?.id;
}

export async function getAppAccessToken(repoWithOwner: string, cache: TokenCache): Promise<string> {
  const installationId = await getInstallationId(repoWithOwner);
  if (!installationId) {
    throw new Error("buncus (or the GitHub App) is not installed on this repository");
  }

  const cached = await cache.get(installationId);
  if (cached?.token) return cached.token;

  const { apiHost } = getConfig();
  const res = await fetch(`${apiHost}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: appHeaders(),
  });
  if (!res.ok) throw new Error("Failed fetching installation access token");
  const { token, expires_at } = await res.json();

  await cache.set({
    installation_id: installationId,
    token,
    expires_at,
    ...(cached?.created_at ? { created_at: cached.created_at } : {}),
  });
  return token;
}
