// Front/back dual-pagination, ported from giscus' useFrontBackDiscussion
// (giscus-eval/services/giscus/discussions.ts). giscus builds this on
// useSWRInfinite; buncus has no SWR dependency, so this is a hand-rolled
// equivalent over plain React state with the same semantics:
//
//   - the "back" stream is the newest page (`{ last: PAGE_SIZE }`), kept pinned;
//   - the "front" stream starts at the oldest page (`{ first: PAGE_SIZE }`) and
//     grows forward (`after` cursor) each time the reader clicks "load more";
//   - the two streams meet in the middle. We can't pass `before` to bound the
//     front (it would change the request and refetch), so duplicates where the
//     streams overlap are removed client-side against the back's first id
//     (`intersectId`), exactly as giscus does.
//   - `numHidden` is the still-unfetched gap between them; it drives the button.
//
// `orderBy` swaps/reverses the two streams so "newest" shows the latest first.
// Unlike giscus we don't do optimistic mutation: after a write the caller calls
// `reload()`, which refetches the back plus the currently-expanded front pages.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IComment, IGiscussion, IUser } from "../github/adapters.ts";
import { type CustomError, fetchDiscussion } from "./api.ts";
import type { WidgetConfig } from "./config.ts";

export type CommentOrder = "oldest" | "newest";

/** Page size for both streams — matches giscus' 15. */
export const PAGE_SIZE = 15;

export type Status = "loading" | "ready" | "notfound" | "error";

export interface DiscussionMeta {
  id: string;
  url: string;
  locked: boolean;
  repository: { nameWithOwner: string };
  reactions: IComment["reactions"];
  reactionCount: number;
}

export interface MergedDiscussion {
  discussion: DiscussionMeta | null;
  viewer: IUser | null;
  /** Older comments (top of the thread for "oldest"), de-duplicated. */
  frontComments: IComment[];
  /** Newest page, pinned to the bottom (for "oldest"). */
  backComments: IComment[];
  /** Unfetched comments between the two streams; 0 hides the button. */
  numHidden: number;
  totalCommentCount: number;
  totalReplyCount: number;
}

const replyCount = (cs: IComment[]) => cs.reduce((n, c) => n + c.replyCount, 0);

/**
 * Pure merge of the two streams, factored out of the hook so it's testable
 * without a DOM. `back` is the newest page (`{ last }`); `frontPages` are the
 * oldest-forward pages (`{ first }`, then `after`). Overlap where they meet is
 * removed by dropping front comments from the back's first id (`intersectId`)
 * onward, then `orderBy` reverses/swaps the streams for newest-first display.
 */
export function mergeFrontBack(
  back: IGiscussion | null,
  frontPages: IGiscussion[],
  orderBy: CommentOrder,
): MergedDiscussion {
  const backDisc = back?.discussion ?? null;
  const backComments = backDisc?.comments ?? [];
  const intersectId = backComments[0]?.id;

  const frontComments: IComment[] = [];
  let hit = false;
  for (const page of frontPages) {
    for (const c of page.discussion?.comments ?? []) {
      if (c.id === intersectId) {
        hit = true;
        break;
      }
      frontComments.push(c);
    }
    if (hit) break;
  }

  const totalCommentCount = backDisc?.totalCommentCount ?? 0;
  const numHidden = Math.max(0, totalCommentCount - backComments.length - frontComments.length);
  const totalReplyCount = replyCount(frontComments) + replyCount(backComments);

  let front = frontComments;
  let bk = backComments;
  if (orderBy === "newest") {
    // Newest first: the back page (latest) moves to the top reversed, the
    // accumulated front (older) moves to the bottom reversed.
    front = backComments.slice().reverse();
    bk = frontComments.slice().reverse();
  }

  const discussion: DiscussionMeta | null = backDisc
    ? {
        id: backDisc.id,
        url: backDisc.url,
        locked: backDisc.locked,
        repository: backDisc.repository,
        reactions: backDisc.reactions,
        reactionCount: backDisc.reactionCount,
      }
    : null;

  return {
    discussion,
    viewer: back?.viewer ?? null,
    frontComments: front,
    backComments: bk,
    numHidden,
    totalCommentCount,
    totalReplyCount,
  };
}

export interface FrontBackDiscussion extends MergedDiscussion {
  status: Status;
  error: string;
  isLoadingMore: boolean;
  /** Fetch the next front page (no-op when nothing more to load). */
  loadMore: () => void;
  /** Refetch back + all currently-expanded front pages (used after writes). */
  reload: () => Promise<void>;
}

async function fetchFrontPages(cfg: WidgetConfig, count: number) {
  const pages = [];
  let after: string | undefined;
  for (let i = 0; i < count; i++) {
    const page = await fetchDiscussion(cfg, { first: PAGE_SIZE, after });
    pages.push(page);
    const info = page.discussion?.pageInfo;
    if (!info?.hasNextPage) break;
    after = info.endCursor;
  }
  return pages;
}

type Page = Awaited<ReturnType<typeof fetchDiscussion>>;

export function useFrontBackDiscussion(config: WidgetConfig, orderBy: CommentOrder): FrontBackDiscussion {
  const [back, setBack] = useState<Page | null>(null);
  const [frontPages, setFrontPages] = useState<Page[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [isLoadingMore, setLoadingMore] = useState(false);

  // How many front pages are expanded, so reload() (post-write) preserves the
  // reader's position instead of collapsing back to page 1.
  const expanded = useRef(1);
  const frontRef = useRef<Page[]>([]);
  frontRef.current = frontPages;

  const fail = useCallback((e: unknown) => {
    const err = e as CustomError;
    if (err.status === 404) setStatus("notfound");
    else {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const [b, f] = await Promise.all([
        fetchDiscussion(config, { last: PAGE_SIZE }),
        fetchFrontPages(config, expanded.current),
      ]);
      setBack(b);
      setFrontPages(f);
      setError("");
      setStatus("ready");
    } catch (e) {
      fail(e);
    }
  }, [config, fail]);

  useEffect(() => {
    reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    const pages = frontRef.current;
    const info = pages[pages.length - 1]?.discussion?.pageInfo;
    if (!info?.hasNextPage || isLoadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchDiscussion(config, { first: PAGE_SIZE, after: info.endCursor });
      expanded.current = pages.length + 1;
      setFrontPages([...pages, next]);
    } catch (e) {
      // A "load more" failure is non-fatal — surface it inline, don't blow away
      // the comments already on screen.
      setError((e as CustomError).message);
    } finally {
      setLoadingMore(false);
    }
  }, [config, isLoadingMore]);

  return useMemo(
    () => ({ ...mergeFrontBack(back, frontPages, orderBy), status, error, isLoadingMore, loadMore, reload }),
    [back, frontPages, orderBy, status, error, isLoadingMore, loadMore, reload],
  );
}
