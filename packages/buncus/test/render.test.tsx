import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/client/components/App.tsx";
import { Comment } from "../src/client/components/Comment.tsx";
import { Reactions } from "../src/client/components/Reactions.tsx";
import { readConfig } from "../src/client/config.ts";
import { makeT } from "../src/client/i18n.ts";
import type { IComment, IReactionGroups } from "../src/github/adapters.ts";
import { REACTIONS } from "../src/github/graphql.ts";

const en = makeT("en");
const de = makeT("de");

function emptyReactions(
  over: Partial<Record<string, { count: number; viewerHasReacted: boolean }>> = {},
): IReactionGroups {
  return Object.fromEntries(
    REACTIONS.map((c) => [c, over[c] ?? { count: 0, viewerHasReacted: false }]),
  ) as IReactionGroups;
}

const comment: IComment = {
  id: "DC_1",
  author: { login: "octocat", avatarUrl: "http://x/a.png", url: "http://gh/octocat" },
  viewerDidAuthor: false,
  createdAt: "2026-01-01T00:00:00Z",
  url: "http://gh/d#1",
  authorAssociation: "NONE",
  lastEditedAt: null,
  deletedAt: null,
  isMinimized: false,
  bodyHTML: "<p>Hello <strong>world</strong></p>",
  reactions: emptyReactions({ HEART: { count: 3, viewerHasReacted: true } }),
  upvoteCount: 0,
  viewerHasUpvoted: false,
  viewerCanUpvote: true,
  replyCount: 1,
  replies: [
    {
      id: "DCR_1",
      author: { login: "hubot", avatarUrl: "http://x/b.png", url: "http://gh/hubot" },
      viewerDidAuthor: false,
      createdAt: "2026-01-02T00:00:00Z",
      url: "http://gh/d#2",
      authorAssociation: "NONE",
      lastEditedAt: null,
      deletedAt: null,
      isMinimized: false,
      bodyHTML: "<p>A reply</p>",
      reactions: emptyReactions(),
      replyToId: "DC_1",
    },
  ],
};

describe("widget renders (no browser)", () => {
  test("Reactions renders all 8 reactions and the active state", () => {
    const html = renderToStaticMarkup(<Reactions t={en} reactions={comment.reactions} onReact={() => {}} />);
    expect(html).toContain("❤️");
    expect(html).toContain("👍");
    expect(html).toContain("bc-reaction--active"); // HEART is active
    expect(html).toContain(">3<"); // HEART count
  });

  test("Comment renders author, body, and a reply", () => {
    const html = renderToStaticMarkup(
      <Comment
        t={en}
        comment={comment}
        signedIn={true}
        onReact={() => {}}
        onReply={async () => {}}
        onSignIn={() => {}}
      />,
    );
    expect(html).toContain("octocat");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("A reply");
    expect(html).toContain("hubot");
  });

  test("Comment localizes the reply button + reaction tooltips (de)", () => {
    const html = renderToStaticMarkup(
      <Comment
        t={de}
        comment={comment}
        signedIn={true}
        onReact={() => {}}
        onReply={async () => {}}
        onSignIn={() => {}}
      />,
    );
    expect(html).toContain(de.reply); // localized "Reply"
    expect(html).toContain(`title="${de.reaction.HEART}"`); // localized reaction name
  });

  test("App initial render shows the loading state", () => {
    const cfg = readConfig("?repo=acme/docs&term=index");
    const html = renderToStaticMarkup(<App config={cfg} />);
    expect(html).toContain("Loading comments");
  });
});
