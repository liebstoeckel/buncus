// In-memory data model for the mock. Stateful: created discussions/comments/
// reactions persist for the lifetime of the instance, so a buncus client can
// create a discussion, comment on it, react, and read it back — exactly the
// flow the real backend exercises.
//
// Shapes are named to mirror giscus' GraphQL selection sets (see SCHEMAS.md and
// giscus-eval/services/github/*.ts). Only the fields buncus actually selects are
// modelled; GraphQL responses are projected from these records in graphql.ts.

import { nextId, resetIds } from "./ids.ts";
import { renderMarkdown } from "./markdown.ts";

export const REACTION_CONTENTS = [
  "THUMBS_UP",
  "THUMBS_DOWN",
  "LAUGH",
  "HOORAY",
  "CONFUSED",
  "HEART",
  "ROCKET",
  "EYES",
] as const;
export type ReactionContent = (typeof REACTION_CONTENTS)[number];

export interface User {
  id: string;
  login: string;
  avatarUrl: string;
  url: string;
  /** GitHub App bot identity (used for anonymous reads + auto-created discussions). */
  isApp?: boolean;
}

export interface Comment {
  id: string;
  parentId: string | null; // null = top-level comment; else the comment it replies to
  discussionId: string;
  authorId: string;
  body: string;
  createdAt: string;
  lastEditedAt: string | null;
  deletedAt: string | null;
  isMinimized: boolean;
  authorAssociation: string;
  // subjectId -> reaction content -> set of userIds
  reactions: Map<ReactionContent, Set<string>>;
  upvoters: Set<string>;
  url: string;
}

export interface Discussion {
  id: string;
  number: number;
  repoId: string;
  repo: string; // owner/name (lowercased)
  categoryId: string;
  title: string;
  body: string;
  locked: boolean;
  createdAt: string;
  url: string;
  reactions: Map<ReactionContent, Set<string>>;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
  /** `<g-emoji>`-wrapped HTML, as GitHub returns it (giscus parses the emoji out). */
  emojiHTML: string;
}

export interface Repo {
  id: string;
  nameWithOwner: string; // canonical (lowercased)
  installationId: number;
  categories: Category[];
  /** Optional giscus.json served from the repo's contents API. */
  config?: unknown;
}

export interface StoreOptions {
  clientId?: string;
  clientSecret?: string;
  appId?: string;
  /** Wall-clock supplier — injectable for deterministic tests. */
  now?: () => Date;
}

function emptyReactions(): Map<ReactionContent, Set<string>> {
  return new Map(REACTION_CONTENTS.map((c) => [c, new Set<string>()]));
}

export class Store {
  clientId: string;
  clientSecret: string;
  appId: string;
  private nowFn: () => Date;

  users = new Map<string, User>();
  repos = new Map<string, Repo>(); // key: lowercased nameWithOwner
  discussions = new Map<string, Discussion>(); // key: discussion node id
  comments = new Map<string, Comment>(); // key: comment node id

  /** access token -> userId. Covers both user OAuth tokens and app installation tokens. */
  tokens = new Map<string, string>();
  /** installation access tokens issued, by installation id (mirrors the cache contract). */
  installationTokens = new Map<number, { token: string; expires_at: string }>();
  /** OAuth authorization codes -> { userId, used }. */
  oauthCodes = new Map<string, { userId: string; used: boolean }>();

  /** The default authenticated end user (who "signs in with GitHub"). */
  viewerUserId!: string;
  /** The GitHub App bot identity (anonymous reads + createDiscussion). */
  appUserId!: string;

  private discussionCounter = 0;

  constructor(opts: StoreOptions = {}) {
    this.clientId = opts.clientId ?? "Iv1.mockclient0000";
    this.clientSecret = opts.clientSecret ?? "mock_client_secret_value";
    this.appId = opts.appId ?? "123456";
    this.nowFn = opts.now ?? (() => new Date());
    this.seed();
  }

  now(): string {
    return this.nowFn().toISOString();
  }

  private seed(): void {
    const dev = this.addUser({
      login: "dev",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      url: "https://github.com/dev",
    });
    const app = this.addUser({
      login: "buncus[bot]",
      avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
      url: "https://github.com/apps/buncus",
      isApp: true,
    });
    this.viewerUserId = dev.id;
    this.appUserId = app.id;

    this.addRepo("acme/docs", {
      installationId: 42,
      categories: [
        { name: "General", emoji: "💬" },
        { name: "Announcements", emoji: "📣" },
      ],
      config: {
        // Permissive by default so any local origin can embed during dev.
        defaultCommentOrder: "oldest",
      },
    });
  }

  addUser(u: Omit<User, "id">): User {
    const user: User = { id: nextId("U"), ...u };
    this.users.set(user.id, user);
    return user;
  }

  addRepo(
    nameWithOwner: string,
    opts: {
      installationId?: number;
      categories?: Array<{ name: string; emoji: string }>;
      config?: unknown;
    } = {},
  ): Repo {
    const key = nameWithOwner.toLowerCase();
    const repo: Repo = {
      id: nextId("R"),
      nameWithOwner: key,
      installationId: opts.installationId ?? 42,
      categories: (opts.categories ?? [{ name: "General", emoji: "💬" }]).map((c) => ({
        id: nextId("DIC"),
        name: c.name,
        emoji: c.emoji,
        emojiHTML: `<div><g-emoji class="g-emoji" alias="${c.name}">${c.emoji}</g-emoji></div>`,
      })),
      config: opts.config,
    };
    this.repos.set(key, repo);
    return repo;
  }

  getRepo(nameWithOwner: string): Repo | undefined {
    return this.repos.get(nameWithOwner.toLowerCase());
  }

  getRepoByInstallationId(id: number): Repo | undefined {
    for (const r of this.repos.values()) if (r.installationId === id) return r;
    return undefined;
  }

  /** Resolve the acting user from a Bearer token; falls back to the app user for installation tokens. */
  userForToken(token?: string | null): User | undefined {
    if (!token) return undefined;
    const userId = this.tokens.get(token);
    if (!userId) return undefined;
    return this.users.get(userId);
  }

  /** Look up a user by login (case-insensitive). Backs the OAuth `mock_user`
   *  affordance so a flow can authenticate as any seeded user, not just the
   *  default viewer — the basis for multi-user e2e scenarios. */
  userByLogin(login: string): User | undefined {
    const l = login.toLowerCase();
    for (const u of this.users.values()) if (u.login.toLowerCase() === l) return u;
    return undefined;
  }

  // ---- OAuth ----------------------------------------------------------------

  issueOAuthCode(userId = this.viewerUserId): string {
    const code = `mockcode_${nextId("C")}`;
    this.oauthCodes.set(code, { userId, used: false });
    return code;
  }

  exchangeCode(code: string): { access_token: string } | { error: string } {
    const entry = this.oauthCodes.get(code);
    if (!entry || entry.used) return { error: "bad_verification_code" };
    entry.used = true;
    const token = `gho_${nextId("T").replace(/[^a-zA-Z0-9]/g, "")}`;
    this.tokens.set(token, entry.userId);
    return { access_token: token };
  }

  /** Mint (or reuse) an app installation access token, mirroring the real ghs_ token. */
  issueInstallationToken(installationId: number): { token: string; expires_at: string } {
    const existing = this.installationTokens.get(installationId);
    if (existing) return existing;
    const token = `ghs_${nextId("A").replace(/[^a-zA-Z0-9]/g, "")}`;
    this.tokens.set(token, this.appUserId);
    // Real installation tokens last 1 hour.
    const expires_at = new Date(this.nowFn().getTime() + 60 * 60 * 1000).toISOString();
    const rec = { token, expires_at };
    this.installationTokens.set(installationId, rec);
    return rec;
  }

  // ---- Discussions / comments ----------------------------------------------

  createDiscussion(input: {
    repositoryId: string;
    categoryId: string;
    title: string;
    body: string;
  }): Discussion {
    const repo = [...this.repos.values()].find((r) => r.id === input.repositoryId);
    if (!repo) throw new Error("Repository not found for repositoryId");
    this.discussionCounter += 1;
    const number = this.discussionCounter;
    const d: Discussion = {
      id: nextId("D"),
      number,
      repoId: repo.id,
      repo: repo.nameWithOwner,
      categoryId: input.categoryId,
      title: input.title,
      body: input.body,
      locked: false,
      createdAt: this.now(),
      url: `https://github.com/${repo.nameWithOwner}/discussions/${number}`,
      reactions: emptyReactions(),
    };
    this.discussions.set(d.id, d);
    return d;
  }

  addComment(discussionId: string, authorId: string, body: string, parentId: string | null = null): Comment {
    const d = this.discussions.get(discussionId);
    if (!d) throw new Error("Discussion not found");
    const c: Comment = {
      id: nextId(parentId ? "DCR" : "DC"),
      parentId,
      discussionId,
      authorId,
      body,
      createdAt: this.now(),
      lastEditedAt: null,
      deletedAt: null,
      isMinimized: false,
      authorAssociation: "NONE",
      reactions: emptyReactions(),
      upvoters: new Set(),
      url: `${d.url}#discussioncomment-${this.comments.size + 1}`,
    };
    this.comments.set(c.id, c);
    return c;
  }

  topLevelComments(discussionId: string): Comment[] {
    return [...this.comments.values()]
      .filter((c) => c.discussionId === discussionId && c.parentId === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  repliesOf(commentId: string): Comment[] {
    return [...this.comments.values()]
      .filter((c) => c.parentId === commentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /** Find the reaction bag for any subject id (a discussion or a comment/reply). */
  reactionsFor(subjectId: string): Map<ReactionContent, Set<string>> | undefined {
    return this.discussions.get(subjectId)?.reactions ?? this.comments.get(subjectId)?.reactions;
  }

  toggleReaction(subjectId: string, content: ReactionContent, userId: string, add: boolean): void {
    const bag = this.reactionsFor(subjectId);
    if (!bag) throw new Error("Subject not found for reaction");
    const set = bag.get(content)!;
    if (add) set.add(userId);
    else set.delete(userId);
  }

  toggleUpvote(subjectId: string, userId: string, add: boolean): number {
    const c = this.comments.get(subjectId);
    if (!c) throw new Error("Subject not found for upvote");
    if (add) c.upvoters.add(userId);
    else c.upvoters.delete(userId);
    return c.upvoters.size;
  }

  /**
   * Replicate giscus discussion search. `query` looks like:
   *   repo:owner/name [category:"General"] in:title "term"
   *   repo:owner/name [category:"General"] in:body "<sha1-hex>"   (strict mode)
   * Returns the most recent match (GitHub uses `last: 1`).
   */
  searchDiscussions(query: string): Discussion[] {
    const repo = query.match(/repo:(\S+)/)?.[1]?.toLowerCase();
    const category = query.match(/category:"([^"]*)"/)?.[1];
    const inBody = /\bin:body\b/.test(query);
    // The search term is the last double-quoted string in the query.
    const quoted = [...query.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    const term = (inBody ? quoted[quoted.length - 1] : quoted[quoted.length - 1]) ?? "";

    const repoObj = repo ? this.getRepo(repo) : undefined;
    const matches = [...this.discussions.values()].filter((d) => {
      if (repo && d.repo !== repo) return false;
      if (category && repoObj) {
        const cat = repoObj.categories.find((c) => c.id === d.categoryId);
        if (!cat || cat.name !== category) return false;
      }
      if (inBody) return d.body.includes(term);
      // in:title — exact match first (created discussions title === term), then contains.
      return d.title === term || d.title.includes(term);
    });
    matches.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return matches;
  }

  /** Render a stored markdown body to GitHub-style sanitised HTML. */
  bodyHTML(body: string): string {
    return renderMarkdown(body);
  }
}

export { resetIds };
