// AES-GCM encryption box with a salted KDF (security-report.md M1).
//
//   key   = scrypt(password, per-record salt, 32)   (N=2^14, r=8, p=1)
//   iv    = 12 random bytes
//   wire  = <32 hex salt><24 hex IV><base64(ciphertext + 16-byte GCM tag)>
//
// scrypt is deliberately expensive, so the derived key is memoised by
// (password, salt). A session string is decoded on every request but always
// carries the same salt, so after the first decode it's an O(1) cache hit.

import { scryptSync, randomBytes } from "node:crypto";

const subtle = globalThis.crypto.subtle;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const KEY_CACHE = new Map<string, CryptoKey>();
const KEY_CACHE_MAX = 2048;

async function deriveKey(password: string, saltHex: string): Promise<CryptoKey> {
  const cacheKey = `${password}|${saltHex}`;
  const hit = KEY_CACHE.get(cacheKey);
  if (hit) return hit;
  const material = scryptSync(password, Buffer.from(saltHex, "hex"), 32, SCRYPT);
  const key = await subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  if (KEY_CACHE.size >= KEY_CACHE_MAX) KEY_CACHE.delete(KEY_CACHE.keys().next().value!);
  KEY_CACHE.set(cacheKey, key);
  return key;
}

export async function encrypt(plaintext: string, password: string): Promise<string> {
  const saltHex = randomBytes(16).toString("hex"); // 32 hex chars
  const iv = randomBytes(12);
  const key = await deriveKey(password, saltHex);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const ivHex = Buffer.from(iv).toString("hex"); // 24 hex chars
  return saltHex + ivHex + Buffer.from(new Uint8Array(ct)).toString("base64");
}

export async function decrypt(ciphertext: string, password: string): Promise<string> {
  const saltHex = ciphertext.slice(0, 32);
  const ivHex = ciphertext.slice(32, 56);
  if (!/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{24}$/.test(ivHex)) {
    throw new Error("Malformed ciphertext.");
  }
  const iv = Uint8Array.from(Buffer.from(ivHex, "hex"));
  const data = Uint8Array.from(Buffer.from(ciphertext.slice(56), "base64"));
  const key = await deriveKey(password, saltHex);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(pt);
}
