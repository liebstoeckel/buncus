import { describe, expect, test } from "bun:test";
import { decrypt, encrypt } from "../src/crypto/encryption.ts";
import { decodeState, encodeState } from "../src/crypto/state.ts";

const PW = "a-sufficiently-long-test-password-aaaaaaaa";

describe("AES-GCM encryption box", () => {
  test("round-trips", async () => {
    const ct = await encrypt("gho_secrettoken", PW);
    expect(ct).not.toContain("gho_");
    expect(await decrypt(ct, PW)).toBe("gho_secrettoken");
  });

  test("wire format: 32 hex salt + 24 hex IV + base64", async () => {
    const ct = await encrypt("x", PW);
    expect(ct.slice(0, 56)).toMatch(/^[0-9a-f]{56}$/); // salt(32) + iv(24)
  });

  test("each encryption uses a fresh salt (no static key)", async () => {
    const a = await encrypt("same", PW);
    const b = await encrypt("same", PW);
    expect(a.slice(0, 32)).not.toBe(b.slice(0, 32)); // salts differ
    expect(await decrypt(a, PW)).toBe("same");
    expect(await decrypt(b, PW)).toBe("same");
  });

  test("wrong password fails to decrypt", async () => {
    const ct = await encrypt("secret", PW);
    await expect(decrypt(ct, "the-wrong-password-the-wrong-password")).rejects.toBeDefined();
  });
});

describe("state box (value + expiry)", () => {
  test("encodes and decodes a value", async () => {
    const s = await encodeState("http://site/page", PW);
    expect(await decodeState(s, PW)).toBe("http://site/page");
  });

  test("expired state is rejected", async () => {
    const s = await encodeState("v", PW, Date.now() - 1000);
    await expect(decodeState(s, PW)).rejects.toThrow("State has expired.");
  });

  test("tampered state is rejected", async () => {
    const s = await encodeState("v", PW);
    await expect(decodeState(`${s.slice(0, -4)}0000`, PW)).rejects.toThrow("Invalid state value.");
  });
});
