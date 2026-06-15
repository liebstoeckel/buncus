import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createMockGitHub, type MockGitHubServer } from "@liebstoeckel/buncus-mock-github";
import { mergeFrontBack } from "../src/client/useFrontBackDiscussion.ts";
import { resetConfig, setConfig } from "../src/config.ts";
import { type Context, createContext } from "../src/context.ts";
import type { IComment, IGiscussion } from "../src/github/adapters.ts";
import { handleApi } from "../src/routes/api.ts";

// ---- mergeFrontBack (pure) ---------------------------------------------------
// The front/back merge is the genuinely tricky new logic (overlap dedup, the
// hidden-gap count, the newest-order swap). Exercised here without a DOM/fetch.

/** Inclusive id range, ascending: ids(0, 2) -> ["c0", "c1", "c2"]. */
function ids(from: number, to: number): string[] {
  const step = from <= to ? 1 : -1;
  const out: string[] = [];
  for (let i = from; step > 0 ? i <= to : i >= to; i += step) out.push(`c${i}`);
  return out;
}

function mkPage(commentIds: string[], total: number, replyCounts: Record<string, number> = {}): IGiscussion {
  const comments = commentIds.map((id) => ({ id, replyCount: replyCounts[id] ?? 0 }) as IComment);
  return {
    viewer: null,
    discussion: {
      id: "D_1",
      url: "https://gh/d/1",
      locked: false,
      repository: { nameWithOwner: "acme/docs" },
      totalCommentCount: total,
      totalReplyCount: 0,
      reactionCount: 0,
      reactions: {} as IComment["reactions"],
      pageInfo: { startCursor: "", endCursor: "", hasNextPage: false, hasPreviousPage: false },
      comments,
    },
  };
}

const idsOf = (cs: IComment[]) => cs.map((c) => c.id);

describe("mergeFrontBack", () => {
  test("large thread: front + back streams leave a hidden gap", () => {
    const back = mkPage(ids(85, 99), 100); // newest 15
    const front = mkPage(ids(0, 14), 100); // oldest 15
    const m = mergeFrontBack(back, [front], "oldest");
    expect(idsOf(m.frontComments)).toEqual(ids(0, 14));
    expect(idsOf(m.backComments)).toEqual(ids(85, 99));
    expect(m.numHidden).toBe(70); // 100 - 15 - 15
    expect(m.totalCommentCount).toBe(100);
    expect(m.discussion?.id).toBe("D_1");
  });

  test("loading more front pages shrinks the gap", () => {
    const back = mkPage(ids(85, 99), 100);
    const pages = [mkPage(ids(0, 14), 100), mkPage(ids(15, 29), 100)];
    const m = mergeFrontBack(back, pages, "oldest");
    expect(idsOf(m.frontComments)).toEqual(ids(0, 29));
    expect(m.numHidden).toBe(55); // 100 - 15 - 30
  });

  test("overlap is de-duplicated against the back's first id (no gap)", () => {
    // total=20: back={last:15}=c5..c19, front={first:15}=c0..c14. They overlap.
    const back = mkPage(ids(5, 19), 20);
    const front = mkPage(ids(0, 14), 20);
    const m = mergeFrontBack(back, [front], "oldest");
    expect(idsOf(m.frontComments)).toEqual(ids(0, 4)); // dedup stops at intersect c5
    expect(idsOf(m.backComments)).toEqual(ids(5, 19));
    expect(m.numHidden).toBe(0);
    // No comment appears twice across the two rendered lists.
    const all = [...idsOf(m.frontComments), ...idsOf(m.backComments)];
    expect(new Set(all).size).toBe(all.length);
  });

  test("a thread that fits one page renders only the back stream", () => {
    const back = mkPage(ids(0, 9), 10);
    const front = mkPage(ids(0, 9), 10);
    const m = mergeFrontBack(back, [front], "oldest");
    expect(m.frontComments).toEqual([]); // front's first id IS the intersect
    expect(idsOf(m.backComments)).toEqual(ids(0, 9));
    expect(m.numHidden).toBe(0);
  });

  test("newest order swaps and reverses both streams", () => {
    const back = mkPage(ids(85, 99), 100);
    const front = mkPage(ids(0, 14), 100);
    const m = mergeFrontBack(back, [front], "newest");
    expect(idsOf(m.frontComments)).toEqual(ids(99, 85)); // newest first, on top
    expect(idsOf(m.backComments)).toEqual(ids(14, 0)); // older, reversed, below
    expect(m.numHidden).toBe(70); // gap is unchanged by ordering
  });

  test("totalReplyCount sums replies across both de-duplicated streams", () => {
    const back = mkPage(ids(5, 7), 8, { c6: 3 });
    const front = mkPage(ids(0, 4), 8, { c1: 2, c5: 99 }); // c5 is dropped by dedup
    const m = mergeFrontBack(back, [front], "oldest");
    expect(m.totalReplyCount).toBe(5); // 2 (front c1) + 3 (back c6); c5 excluded
  });

  test("null back (not loaded) yields an empty, safe shape", () => {
    const m = mergeFrontBack(null, [], "oldest");
    expect(m.discussion).toBeNull();
    expect(m.viewer).toBeNull();
    expect(m.frontComments).toEqual([]);
    expect(m.backComments).toEqual([]);
    expect(m.numHidden).toBe(0);
    expect(m.totalCommentCount).toBe(0);
  });
});

// ---- API cursor pagination (buncus proxy -> mock GitHub) ---------------------
// Validates the read path actually honours first/last/after/before and surfaces
// the cursors the front/back streams depend on.

let mock: MockGitHubServer;
let ctx: Context;
const PUBLIC = "http://buncus.test";

beforeAll(() => {
  // Monotonic clock so seeded comments sort by insertion order deterministically.
  let tick = 0;
  mock = createMockGitHub({ now: () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000) }).listen(0);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  resetConfig();
  setConfig({
    publicUrl: PUBLIC,
    apiHost: mock.url,
    oauthHost: mock.url,
    appId: mock.store.appId,
    clientId: mock.store.clientId,
    clientSecret: mock.store.clientSecret,
    privateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    encryptionPassword: "test-password-test-password-test-password",
    dbPath: ":memory:",
    origins: ["http://site"],
    originsRegex: [],
  });
  ctx = createContext();
});

afterAll(() => mock.stop());

/** Anonymous read of a seeded discussion by number, with pagination params. */
async function read(number: number, params: Record<string, string>) {
  const q = new URLSearchParams({ repo: "acme/docs", number: String(number), ...params });
  const req = new Request(`${PUBLIC}/api/discussions?${q}`, { method: "GET" });
  const res = await handleApi(req, new URL(req.url), ctx);
  return (await res?.json()) as IGiscussion;
}

describe("API cursor pagination against mock GitHub", () => {
  const N = 40;
  let number: number;

  beforeAll(() => {
    const repo = mock.store.getRepo("acme/docs")!;
    const d = mock.store.createDiscussion({
      repositoryId: repo.id,
      categoryId: repo.categories[0].id,
      title: "paging/thread",
      body: "seed",
    });
    number = d.number;
    for (let i = 1; i <= N; i++) mock.store.addComment(d.id, mock.store.viewerUserId, `comment ${i}`);
  });

  test("{last:15} returns the newest page, flagged as having older comments", async () => {
    const { discussion } = await read(number, { last: "15" });
    expect(discussion!.totalCommentCount).toBe(N);
    expect(discussion!.comments).toHaveLength(15);
    expect(discussion!.comments[0].bodyHTML).toContain("comment 26");
    expect(discussion!.comments.at(-1)!.bodyHTML).toContain("comment 40");
    expect(discussion!.pageInfo.hasPreviousPage).toBe(true);
    expect(discussion!.pageInfo.hasNextPage).toBe(false);
  });

  test("{first:15} then walking the `after` cursor pages forward", async () => {
    const page0 = (await read(number, { first: "15" })).discussion!;
    expect(page0.comments[0].bodyHTML).toContain("comment 1");
    expect(page0.comments.at(-1)!.bodyHTML).toContain("comment 15");
    expect(page0.pageInfo.hasNextPage).toBe(true);
    expect(page0.pageInfo.hasPreviousPage).toBe(false);

    const page1 = (await read(number, { first: "15", after: page0.pageInfo.endCursor })).discussion!;
    expect(page1.comments[0].bodyHTML).toContain("comment 16");
    expect(page1.comments.at(-1)!.bodyHTML).toContain("comment 30");
    expect(page1.pageInfo.hasNextPage).toBe(true);
  });

  test("front {first:15} and back {last:15} streams cover the thread with a known gap", async () => {
    const front = (await read(number, { first: "15" })).discussion!;
    const back = (await read(number, { last: "15" })).discussion!;
    const gap = back.totalCommentCount - front.comments.length - back.comments.length;
    expect(gap).toBe(10); // 40 - 15 - 15: exactly what numHidden reports
  });
});
