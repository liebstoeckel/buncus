// Stateful token box: encrypts a value + expiry into an opaque string.
// Used for (a) the OAuth `state` (5-min CSRF/return-URL carrier) and
// (b) the long-lived session token that stands in for the GitHub user token.

import { decrypt, encrypt } from "./encryption.ts";

const FIVE_MINUTES = 5 * 60 * 1000;
export const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

export async function encodeState(
  value: string,
  password: string,
  expires: number = Date.now() + FIVE_MINUTES,
): Promise<string> {
  return encrypt(JSON.stringify({ value, expires }), password);
}

export async function decodeState(state: string, password: string): Promise<string> {
  let parsed: { value: string; expires: number };
  try {
    parsed = JSON.parse(await decrypt(state, password));
  } catch {
    throw new Error("Invalid state value.");
  }
  if (Date.now() > parsed.expires) throw new Error("State has expired.");
  return parsed.value;
}
