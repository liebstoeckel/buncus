// GitHub App JWT (RS256). giscus uses the `jsonwebtoken` npm package; buncus
// signs with node:crypto (built into Bun) to stay dependency-free.

import { createSign } from "node:crypto";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Sign a GitHub App JWT: iss=appId, iat back-dated 60s, exp 10 min out. */
export function signAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 10 * 60, iss: appId };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${b64url(signature)}`;
}
