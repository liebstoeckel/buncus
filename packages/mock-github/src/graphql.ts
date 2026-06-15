// GraphQL dispatcher. giscus issues a fixed, small set of operations against
// https://api.github.com/graphql (see giscus-eval/services/github/*.ts). Rather
// than run a real GraphQL engine, we detect the operation from the query string
// + variables and project store records into the exact selection-set shapes
// giscus' adapters consume (giscus-eval/lib/adapter.ts).

import { Store, REACTION_CONTENTS, type Comment, type Discussion, type ReactionContent, type User } from "./store.ts";

interface GqlBody {
  query: string;
  variables?: Record<string, any>;
}

function projectUser(u: User | undefined) {
  if (!u) return null;
  return { avatarUrl: u.avatarUrl, login: u.login, url: u.url };
}

function projectReactionGroups(bag: Map<ReactionContent, Set<string>>, viewerId?: string) {
  // GitHub returns a group for every ReactionContent.
  return REACTION_CONTENTS.map((content) => {
    const set = bag.get(content)!;
    return {
      content,
      users: { totalCount: set.size },
      viewerHasReacted: viewerId ? set.has(viewerId) : false,
    };
  });
}

function reactionTotal(bag: Map<ReactionContent, Set<string>>): number {
  let n = 0;
  for (const set of bag.values()) n += set.size;
  return n;
}

function projectReply(store: Store, reply: Comment, viewerId?: string) {
  const author = store.users.get(reply.authorId);
  return {
    id: reply.id,
    author: projectUser(author),
    viewerDidAuthor: viewerId === reply.authorId,
    createdAt: reply.createdAt,
    url: reply.url,
    authorAssociation: reply.authorAssociation,
    lastEditedAt: reply.lastEditedAt,
    deletedAt: reply.deletedAt,
    isMinimized: reply.isMinimized,
    bodyHTML: store.bodyHTML(reply.body),
    reactionGroups: projectReactionGroups(reply.reactions, viewerId),
    replyTo: { id: reply.parentId },
  };
}

function projectComment(store: Store, comment: Comment, viewerId?: string) {
  const author = store.users.get(comment.authorId);
  const replies = store.repliesOf(comment.id);
  return {
    id: comment.id,
    upvoteCount: comment.upvoters.size,
    viewerHasUpvoted: viewerId ? comment.upvoters.has(viewerId) : false,
    viewerCanUpvote: true,
    author: projectUser(author),
    viewerDidAuthor: viewerId === comment.authorId,
    createdAt: comment.createdAt,
    url: comment.url,
    authorAssociation: comment.authorAssociation,
    lastEditedAt: comment.lastEditedAt,
    deletedAt: comment.deletedAt,
    isMinimized: comment.isMinimized,
    bodyHTML: store.bodyHTML(comment.body),
    reactionGroups: projectReactionGroups(comment.reactions, viewerId),
    replies: {
      totalCount: replies.length,
      nodes: replies.slice(0, 100).map((r) => projectReply(store, r, viewerId)),
    },
  };
}

function cursor(i: number): string {
  return Buffer.from(`cursor:${i}`).toString("base64");
}
function decodeCursor(c: string): number {
  return Number(Buffer.from(c, "base64").toString().split(":")[1]);
}

function paginate<T>(
  all: T[],
  args: { first?: number; last?: number; after?: string; before?: string },
): { nodes: T[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasNextPage: boolean; hasPreviousPage: boolean } } {
  let start = 0;
  let end = all.length;
  if (args.after) start = decodeCursor(args.after) + 1;
  if (args.before) end = decodeCursor(args.before);
  const windowed = all.slice(start, end).map((node, k) => ({ node, index: start + k }));

  let chosen = windowed;
  if (args.first != null && !Number.isNaN(args.first)) {
    chosen = windowed.slice(0, args.first);
  } else if (args.last != null && !Number.isNaN(args.last)) {
    chosen = windowed.slice(Math.max(0, windowed.length - args.last));
  }

  const first = chosen[0];
  const lastItem = chosen[chosen.length - 1];
  return {
    nodes: chosen.map((x) => x.node),
    pageInfo: {
      startCursor: first ? cursor(first.index) : null,
      endCursor: lastItem ? cursor(lastItem.index) : null,
      hasPreviousPage: first ? first.index > 0 : false,
      hasNextPage: lastItem ? lastItem.index < all.length - 1 : false,
    },
  };
}

function projectDiscussion(store: Store, d: Discussion, viewerId: string | undefined, args: any) {
  const comments = store.topLevelComments(d.id);
  const page = paginate(comments, {
    first: args.first,
    last: args.last,
    after: args.after,
    before: args.before,
  });
  return {
    id: d.id,
    url: d.url,
    locked: d.locked,
    repository: { nameWithOwner: store.repos.get(d.repo)?.nameWithOwner ?? d.repo },
    reactions: { totalCount: reactionTotal(d.reactions) },
    reactionGroups: projectReactionGroups(d.reactions, viewerId),
    comments: {
      totalCount: comments.length,
      pageInfo: page.pageInfo,
      nodes: page.nodes.map((c) => projectComment(store, c, viewerId)),
    },
  };
}

export function handleGraphQL(store: Store, body: GqlBody, token?: string | null): { status: number; json: any } {
  const q = body.query ?? "";
  const v = body.variables ?? {};
  const viewer = store.userForToken(token);
  const viewerId = viewer?.id;

  // ---- Mutations (order matters: reply aliases addDiscussionComment) --------

  if (q.includes("createDiscussion(input:")) {
    if (!viewer) return unauthorized();
    const d = store.createDiscussion(v.input);
    return { status: 200, json: { data: { createDiscussion: { discussion: { id: d.id } } } } };
  }

  if (v.replyToId !== undefined || q.includes("addDiscussionReply:")) {
    if (!viewer) return unauthorized();
    const reply = store.addComment(v.discussionId, viewer.id, v.body, v.replyToId);
    return { status: 200, json: { data: { addDiscussionReply: { reply: projectReply(store, reply, viewerId) } } } };
  }

  if (q.includes("addDiscussionComment(input:")) {
    if (!viewer) return unauthorized();
    const comment = store.addComment(v.discussionId, viewer.id, v.body, null);
    return { status: 200, json: { data: { addDiscussionComment: { comment: projectComment(store, comment, viewerId) } } } };
  }

  if (q.includes("Reaction(input:")) {
    if (!viewer) return unauthorized();
    const add = q.includes("addReaction(");
    store.toggleReaction(v.subjectId, v.content, viewer.id, add);
    return { status: 200, json: { data: { toggleReaction: { reaction: { content: v.content, id: `RE_${v.subjectId}_${v.content}` } } } } };
  }

  if (q.includes("Upvote(input:")) {
    if (!viewer) return unauthorized();
    const add = q.includes("addUpvote(");
    const count = store.toggleUpvote(v.upvoteInput.subjectId, viewer.id, add);
    return { status: 200, json: { data: { toggleUpvote: { subject: { upvoteCount: count } } } } };
  }

  // ---- Queries --------------------------------------------------------------

  if (q.includes("search(type: REPOSITORY")) {
    const repoName = v.query?.match(/repo:(\S+)/)?.[1];
    const repo = repoName ? store.getRepo(repoName) : undefined;
    const nodes = repo
      ? [
          {
            id: repo.id,
            discussionCategories: {
              nodes: repo.categories.map((c) => ({ id: c.id, name: c.name, emojiHTML: c.emojiHTML })),
            },
          },
        ]
      : [];
    return { status: 200, json: { data: { search: { nodes } } } };
  }

  if (q.includes("search(type: DISCUSSION")) {
    const matches = store.searchDiscussions(v.query ?? "");
    // giscus uses `last: 1` — return the most recent match only.
    const node = matches.length ? projectDiscussion(store, matches[matches.length - 1], viewerId, v) : undefined;
    return {
      status: 200,
      json: {
        data: {
          viewer: projectUser(viewer),
          search: { discussionCount: matches.length, nodes: node ? [node] : [] },
        },
      },
    };
  }

  if (q.includes("discussion(number:")) {
    const repo = store.getRepo(`${v.owner}/${v.name}`);
    const found = repo
      ? [...store.discussions.values()].find((d) => d.repo === repo.nameWithOwner && d.number === v.number)
      : undefined;
    return {
      status: 200,
      json: {
        data: {
          viewer: projectUser(viewer),
          repository: { discussion: found ? projectDiscussion(store, found, viewerId, v) : null },
        },
      },
    };
  }

  return { status: 200, json: { errors: [{ message: `Mock GraphQL: unrecognized operation` }] } };
}

function unauthorized() {
  return { status: 200, json: { errors: [{ type: "FORBIDDEN", message: "Bad credentials" }] } };
}
