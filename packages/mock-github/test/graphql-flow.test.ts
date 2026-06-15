import { beforeEach, describe, expect, test } from "bun:test";
import { createMockGitHub, type MockGitHub, resetIds } from "../src/index.ts";

const BASE = "http://gh";
let mock: MockGitHub;
let userToken: string;

beforeEach(() => {
  resetIds();
  mock = createMockGitHub();
  const code = mock.store.issueOAuthCode();
  userToken = (mock.store.exchangeCode(code) as { access_token: string }).access_token;
});

async function gql(query: string, variables: Record<string, any>, token = userToken) {
  const res = await mock.fetch(
    new Request(`${BASE}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    }),
  );
  return res.json();
}

const repoIds = () => {
  const repo = mock.store.getRepo("acme/docs")!;
  return { repositoryId: repo.id, categoryId: repo.categories[0].id };
};

const CREATE = `mutation($input: CreateDiscussionInput!){ createDiscussion(input: $input){ discussion { id } } }`;
const SEARCH = `query($query: String!){ viewer { login } search(type: DISCUSSION last: 1 query: $query){ discussionCount nodes { ... on Discussion { id } } } }`;
const ADD_COMMENT = `mutation($body: String!, $discussionId: ID!){ addDiscussionComment(input: {body: $body, discussionId: $discussionId}){ comment { id } } }`;
const ADD_REPLY = `mutation($body: String!, $discussionId: ID!, $replyToId: ID!){ addDiscussionReply: addDiscussionComment(input: {body: $body, discussionId: $discussionId, replyToId: $replyToId}){ reply: comment { id } } }`;
const REACT = `mutation($content: ReactionContent!, $subjectId: ID!){ toggleReaction: addReaction(input: {content: $content, subjectId: $subjectId}){ reaction { id } } }`;
const UPVOTE = `mutation($upvoteInput: AddUpvoteInput!){ toggleUpvote: addUpvote(input: $upvoteInput){ subject { upvoteCount } } }`;
const CATEGORIES = `query($query: String!){ search(type: REPOSITORY query: $query first:1){ nodes { ... on Repository { id discussionCategories(first:100){ nodes { id name emojiHTML } } } } } }`;

describe("GraphQL: categories", () => {
  test("returns seeded categories with parseable emoji", async () => {
    const data = await gql(CATEGORIES, { query: "repo:acme/docs fork:true" });
    const repo = data.data.search.nodes[0];
    expect(repo.id).toBe(mock.store.getRepo("acme/docs")?.id);
    const cats = repo.discussionCategories.nodes;
    expect(cats.map((c: any) => c.name)).toEqual(["General", "Announcements"]);
    // giscus parses the emoji out of emojiHTML with /">(.*?)<\/g-emoji/
    const emoji = cats[0].emojiHTML.match(/">(.*?)<\/g-emoji/)?.[1];
    expect(emoji).toBe("💬");
  });
});

describe("GraphQL: full discussion lifecycle", () => {
  test("create → search finds it → comment → reply → react → read back", async () => {
    const { repositoryId, categoryId } = repoIds();

    // 1. Create a discussion whose title is the mapping term "guide/intro".
    const created = await gql(CREATE, {
      input: { repositoryId, categoryId, title: "guide/intro", body: "Welcome\n\n<!-- sha1: abc -->" },
    });
    const discussionId = created.data.createDiscussion.discussion.id;
    expect(discussionId).toMatch(/^D_/);

    // 2. Search by term (in:title) finds the discussion.
    const search = await gql(SEARCH, { query: 'repo:acme/docs  in:title "guide/intro"' });
    expect(search.data.search.discussionCount).toBe(1);
    expect(search.data.search.nodes[0].id).toBe(discussionId);
    expect(search.data.viewer.login).toBe("dev");

    // 3. Add a top-level comment.
    const c = await gql(ADD_COMMENT, { body: "First **comment**", discussionId });
    const commentId = c.data.addDiscussionComment.comment.id;
    expect(commentId).toMatch(/^DC_/);

    // 4. Reply to it.
    const r = await gql(ADD_REPLY, { body: "A reply", discussionId, replyToId: commentId });
    expect(r.data.addDiscussionReply.reply.replyTo.id).toBe(commentId);

    // 5. React to the comment.
    await gql(REACT, { content: "HEART", subjectId: commentId });

    // 6. Read the discussion back (full selection set used by /api/discussions).
    const read = await gql(SEARCH_FULL, { query: 'repo:acme/docs  in:title "guide/intro"', first: 20 });
    const d = read.data.search.nodes[0];
    expect(d.comments.totalCount).toBe(1);
    const comment = d.comments.nodes[0];
    expect(comment.bodyHTML).toContain("<strong>comment</strong>");
    expect(comment.replies.totalCount).toBe(1);
    const heart = comment.reactionGroups.find((g: any) => g.content === "HEART");
    expect(heart.users.totalCount).toBe(1);
    expect(heart.viewerHasReacted).toBe(true);
  });

  test("strict mode matches the sha1 body marker (in:body)", async () => {
    const { repositoryId, categoryId } = repoIds();
    await gql(CREATE, {
      input: { repositoryId, categoryId, title: "anything", body: "Body text\n\n<!-- sha1: deadbeef -->" },
    });
    const search = await gql(SEARCH, { query: 'repo:acme/docs  in:body "deadbeef"' });
    expect(search.data.search.discussionCount).toBe(1);
  });

  test("upvote toggles count", async () => {
    const { repositoryId, categoryId } = repoIds();
    const created = await gql(CREATE, {
      input: { repositoryId, categoryId, title: "u", body: "b" },
    });
    const discussionId = created.data.createDiscussion.discussion.id;
    const c = await gql(ADD_COMMENT, { body: "hi", discussionId });
    const commentId = c.data.addDiscussionComment.comment.id;

    const up = await gql(UPVOTE, { upvoteInput: { subjectId: commentId } });
    expect(up.data.toggleUpvote.subject.upvoteCount).toBe(1);
  });

  test("missing discussion → discussionCount 0, no nodes", async () => {
    const search = await gql(SEARCH, { query: 'repo:acme/docs  in:title "nope"' });
    expect(search.data.search.discussionCount).toBe(0);
    expect(search.data.search.nodes).toEqual([]);
  });

  test("anonymous app-token reads return the app viewer", async () => {
    const { repositoryId, categoryId } = repoIds();
    await gql(CREATE, { input: { repositoryId, categoryId, title: "p", body: "b" } });
    const appToken = mock.store.issueInstallationToken(42).token;
    const search = await gql(SEARCH, { query: 'repo:acme/docs  in:title "p"' }, appToken);
    expect(search.data.viewer.login).toBe("buncus[bot]");
  });

  test("unauthenticated mutation reports Bad credentials", async () => {
    const { repositoryId, categoryId } = repoIds();
    const res = await gql(CREATE, { input: { repositoryId, categoryId, title: "x", body: "y" } }, "gho_bogus");
    expect(res.errors[0].message).toContain("Bad credentials");
  });
});

// Full read selection set (subset of giscus' DISCUSSION_QUERY) used by step 6 above.
const SEARCH_FULL = `query($query: String!, $first: Int){
  viewer { login }
  search(type: DISCUSSION last: 1 query: $query){
    discussionCount
    nodes { ... on Discussion {
      id url locked
      comments(first: $first){
        totalCount
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        nodes { id bodyHTML reactionGroups { content users { totalCount } viewerHasReacted } replies(last:100){ totalCount nodes { id } } }
      }
    } }
  }
}`;
