// Shared application context (the in-process singletons a request needs).

import { TokenCache } from "./cache/tokenCache.ts";
import { getConfig } from "./config.ts";
import { decodeState } from "./crypto/state.ts";
import { getAppAccessToken } from "./github/appToken.ts";

export interface Context {
  cache: TokenCache;
}

export function createContext(): Context {
  const cfg = getConfig();
  return { cache: new TokenCache(cfg.dbPath, cfg.encryptionPassword) };
}

/** The opaque session the browser holds (encrypted GitHub user token). */
export function readSession(req: Request): string | undefined {
  // Same-origin widget calls send the session in a header; never a cookie, so
  // it can't be sent by third-party pages (CSRF-safe by construction).
  return req.headers.get("x-buncus-session") ?? undefined;
}

/**
 * Resolve a GitHub token for an operation:
 *   - a valid session  → the user's token (decrypted),
 *   - otherwise         → an app installation token for `repo` (anonymous reads).
 * Returns `{ token, isUser }`.
 */
export async function resolveToken(
  req: Request,
  repo: string,
  ctx: Context,
): Promise<{ token: string; isUser: boolean }> {
  const session = readSession(req);
  if (session) {
    try {
      const token = await decodeState(session, getConfig().encryptionPassword);
      return { token, isUser: true };
    } catch {
      // fall through to app token; the widget will surface a re-auth prompt
    }
  }
  const token = await getAppAccessToken(repo, ctx.cache);
  return { token, isUser: false };
}

/** Resolve strictly a user token (for writes); throws if not signed in. */
export async function requireUserToken(req: Request): Promise<string> {
  const session = readSession(req);
  if (!session) throw new Error("Sign in required.");
  return decodeState(session, getConfig().encryptionPassword);
}
