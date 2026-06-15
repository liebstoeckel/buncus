// Thin client for buncus' own same-origin API. The session (opaque, encrypted)
// is attached as a header; the GitHub token never lives in browser JS.

import type { IGiscussion } from "../github/adapters.ts";
import type { ReactionContent } from "../github/graphql.ts";
import type { WidgetConfig } from "./config.ts";

export interface Category {
  id: string;
  name: string;
  emoji: string;
}

function headers(session: string, body = false): HeadersInit {
  const h: Record<string, string> = {};
  if (session) h["x-buncus-session"] = session;
  if (body) h["content-type"] = "application/json";
  return h;
}

export class CustomError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CustomError(data.error || res.statusText, res.status);
  return data;
}

export async function fetchDiscussion(cfg: WidgetConfig, first = 50): Promise<IGiscussion> {
  const q = new URLSearchParams({ repo: cfg.repo, first: String(first) });
  if (cfg.number) q.set("number", String(cfg.number));
  else q.set("term", cfg.term);
  if (cfg.category) q.set("category", cfg.category);
  if (cfg.strict) q.set("strict", "1");
  const res = await fetch(`/api/discussions?${q}`, { headers: headers(cfg.session) });
  return jsonOrThrow(res);
}

export async function createDiscussion(cfg: WidgetConfig): Promise<{ id: string }> {
  const res = await fetch("/api/discussions", {
    method: "POST",
    headers: headers(cfg.session, true),
    body: JSON.stringify({
      repo: cfg.repo,
      repositoryId: cfg.repoId,
      categoryId: cfg.categoryId,
      title: cfg.term,
      body: cfg.backLink || cfg.description,
    }),
  });
  return jsonOrThrow(res);
}

export async function postComment(session: string, discussionId: string, body: string) {
  return jsonOrThrow(
    await fetch("/api/comment", {
      method: "POST",
      headers: headers(session, true),
      body: JSON.stringify({ discussionId, body }),
    }),
  );
}

export async function postReply(session: string, discussionId: string, replyToId: string, body: string) {
  return jsonOrThrow(
    await fetch("/api/reply", {
      method: "POST",
      headers: headers(session, true),
      body: JSON.stringify({ discussionId, replyToId, body }),
    }),
  );
}

export async function react(session: string, subjectId: string, content: ReactionContent, viewerHasReacted: boolean) {
  return jsonOrThrow(
    await fetch("/api/reaction", {
      method: "POST",
      headers: headers(session, true),
      body: JSON.stringify({ subjectId, content, viewerHasReacted }),
    }),
  );
}
