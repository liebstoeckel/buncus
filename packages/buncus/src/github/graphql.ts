// GitHub GraphQL operations. Query strings are ported verbatim from giscus
// (giscus-eval/services/github/*.ts) so they stay schema-faithful.

import { getConfig } from "../config.ts";

export type { ReactionContent } from "../shared/reactions.ts";
// Re-exported from the dependency-free shared module so client code can import
// the constants without pulling in server config (see shared/reactions.ts).
export { REACTIONS } from "../shared/reactions.ts";

import type { ReactionContent } from "../shared/reactions.ts";

export interface PaginationParams {
  first?: number;
  last?: number;
  after?: string;
  before?: string;
}

async function gql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const { apiHost } = getConfig();
  const res = await fetch(`${apiHost}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "buncus",
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<T>;
}

export async function digestMessage(message: string, algorithm: AlgorithmIdentifier = "SHA-1"): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest(algorithm, new TextEncoder().encode(message));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseRepo(repoWithOwner: string) {
  const [owner, name] = repoWithOwner.split("/");
  return { owner, name };
}

const DISCUSSION_QUERY = `
  id url locked
  repository { nameWithOwner }
  reactions { totalCount }
  reactionGroups { content users { totalCount } viewerHasReacted }
  comments(first: $first last: $last after: $after before: $before) {
    totalCount
    pageInfo { startCursor hasNextPage hasPreviousPage endCursor }
    nodes {
      id upvoteCount viewerHasUpvoted viewerCanUpvote
      author { avatarUrl login url }
      viewerDidAuthor createdAt url authorAssociation lastEditedAt deletedAt isMinimized bodyHTML
      reactionGroups { content users { totalCount } viewerHasReacted }
      replies(last: 100) {
        totalCount
        nodes {
          id author { avatarUrl login url }
          viewerDidAuthor createdAt url authorAssociation lastEditedAt deletedAt isMinimized bodyHTML
          reactionGroups { content users { totalCount } viewerHasReacted }
          replyTo { id }
        }
      }
    }
  }`;

const SEARCH_QUERY = (type: "term" | "number") => `
  query(${type === "term" ? "$query: String!" : "$owner: String! $name: String! $number: Int!"} $first: Int $last: Int $after: String $before: String) {
    viewer { avatarUrl login url }
    ${
      type === "term"
        ? `search(type: DISCUSSION last: 1 query: $query) { discussionCount nodes { ... on Discussion { ${DISCUSSION_QUERY} } } }`
        : `repository(owner: $owner, name: $name) { discussion(number: $number) { ${DISCUSSION_QUERY} } }`
    }
  }`;

export interface DiscussionQuery {
  repo: string;
  term: string;
  number: number;
  category: string;
  strict: boolean;
}

export async function getDiscussion(params: DiscussionQuery & PaginationParams, token: string): Promise<any> {
  const { repo: repoRaw, term, number, category, strict, ...pagination } = params;
  const repo = repoRaw.toLowerCase();
  const resolvedTerm = strict ? await digestMessage(term) : term;
  const searchIn = strict ? "in:body" : "in:title";
  const categoryQuery = category ? `category:${JSON.stringify(category)}` : "";
  const query = `repo:${repo} ${categoryQuery} ${searchIn} ${JSON.stringify(resolvedTerm)}`;
  return gql(
    SEARCH_QUERY(number ? "number" : "term"),
    { repo, query, number, ...parseRepo(repo), ...pagination },
    token,
  );
}

const CATEGORIES_QUERY = `
  query($query: String!) {
    search(type: REPOSITORY query: $query first: 1) {
      nodes { ... on Repository { id discussionCategories(first: 100) { nodes { id name emojiHTML } } } }
    }
  }`;

export async function getDiscussionCategories(repo: string, token: string): Promise<any> {
  return gql(CATEGORIES_QUERY, { query: `repo:${repo} fork:true` }, token);
}

const CREATE_DISCUSSION = `
  mutation($input: CreateDiscussionInput!) {
    createDiscussion(input: $input) { discussion { id } }
  }`;

export interface CreateDiscussionInput {
  repositoryId: string;
  categoryId: string;
  title: string;
  body: string;
}

export async function createDiscussion(input: CreateDiscussionInput, token: string): Promise<any> {
  return gql(CREATE_DISCUSSION, { input }, token);
}

const COMMENT_SELECTION = `
  id upvoteCount viewerHasUpvoted viewerCanUpvote
  author { avatarUrl login url }
  viewerDidAuthor createdAt url authorAssociation lastEditedAt deletedAt isMinimized bodyHTML
  reactionGroups { content users { totalCount } viewerHasReacted }
  replies(first: 100) { totalCount nodes {
    id author { avatarUrl login url } viewerDidAuthor createdAt url authorAssociation lastEditedAt deletedAt isMinimized bodyHTML
    reactionGroups { content users { totalCount } viewerHasReacted } replyTo { id }
  } }`;

const ADD_COMMENT = `
  mutation($body: String!, $discussionId: ID!) {
    addDiscussionComment(input: {body: $body, discussionId: $discussionId}) { comment { ${COMMENT_SELECTION} } }
  }`;

export async function addDiscussionComment(body: string, discussionId: string, token: string): Promise<any> {
  return gql(ADD_COMMENT, { body, discussionId }, token);
}

const ADD_REPLY = `
  mutation($body: String!, $discussionId: ID!, $replyToId: ID!) {
    addDiscussionReply: addDiscussionComment(input: {body: $body, discussionId: $discussionId, replyToId: $replyToId}) {
      reply: comment {
        id author { avatarUrl login url } viewerDidAuthor createdAt url authorAssociation lastEditedAt deletedAt isMinimized bodyHTML
        reactionGroups { content users { totalCount } viewerHasReacted } replyTo { id }
      }
    }
  }`;

export async function addDiscussionReply(
  body: string,
  discussionId: string,
  replyToId: string,
  token: string,
): Promise<any> {
  return gql(ADD_REPLY, { body, discussionId, replyToId }, token);
}

const TOGGLE_REACTION = (mode: "add" | "remove") => `
  mutation($content: ReactionContent!, $subjectId: ID!) {
    toggleReaction: ${mode}Reaction(input: {content: $content, subjectId: $subjectId}) { reaction { content id } }
  }`;

export async function toggleReaction(
  content: ReactionContent,
  subjectId: string,
  viewerHasReacted: boolean,
  token: string,
): Promise<any> {
  return gql(TOGGLE_REACTION(viewerHasReacted ? "remove" : "add"), { content, subjectId }, token);
}
