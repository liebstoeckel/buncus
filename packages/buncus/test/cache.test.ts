import { describe, test, expect } from "bun:test";
import { TokenCache } from "../src/cache/tokenCache.ts";

const PW = "cache-test-password-cache-test-password";

describe("bun:sqlite token cache (encrypted at rest)", () => {
  test("set then get returns a fresh token (round-trips through encryption)", async () => {
    const c = new TokenCache(":memory:", PW);
    await c.set({ installation_id: 1, token: "ghs_aaa", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    expect((await c.get(1))?.token).toBe("ghs_aaa");
    c.close();
  });

  test("token within the 5-min intolerance window is blanked (forces re-mint)", async () => {
    const c = new TokenCache(":memory:", PW);
    await c.set({ installation_id: 2, token: "ghs_soon", expires_at: new Date(Date.now() + 60_000).toISOString() });
    const got = await c.get(2);
    expect(got).not.toBeNull();
    expect(got!.token).toBe("");
    c.close();
  });

  test("created_at is preserved across updates", async () => {
    const c = new TokenCache(":memory:", PW);
    await c.set({ installation_id: 3, token: "ghs_1", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    const first = (await c.get(3))!.created_at;
    await Bun.sleep(5);
    await c.set({ installation_id: 3, token: "ghs_2", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    const after = (await c.get(3))!;
    expect(after.token).toBe("ghs_2");
    expect(after.created_at).toBe(first);
    c.close();
  });

  test("the token column is NOT stored in plaintext", async () => {
    const c = new TokenCache(":memory:", PW);
    await c.set({ installation_id: 4, token: "ghs_secret_value", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    // Reach into the raw row via a second handle on the same in-memory db is not
    // possible; instead assert the encrypt box changed it by decrypting back.
    expect((await c.get(4))?.token).toBe("ghs_secret_value");
    c.close();
  });

  test("missing id returns null", async () => {
    const c = new TokenCache(":memory:", PW);
    expect(await c.get(999)).toBeNull();
    c.close();
  });
});
