// Adapt GitHub GraphQL shapes into the flat shapes the widget renders.
// Ported from giscus' lib/adapter.ts (reaction-group folding, ghost-user
// fallback, reply/comment/discussion flattening).

import { REACTIONS, type ReactionContent } from "./graphql.ts";

export interface IUser {
  avatarUrl: string;
  login: string;
  url: string;
}

export type IReactionGroups = Record<ReactionContent, { count: number; viewerHasReacted: boolean }>;

export interface IReply {
  id: string;
  author: IUser;
  viewerDidAuthor: boolean;
  createdAt: string;
  url: string;
  authorAssociation: string;
  lastEditedAt: string | null;
  deletedAt: string | null;
  isMinimized: boolean;
  bodyHTML: string;
  reactions: IReactionGroups;
  replyToId: string;
}

export interface IComment extends Omit<IReply, "replyToId"> {
  upvoteCount: number;
  viewerHasUpvoted: boolean;
  viewerCanUpvote: boolean;
  replyCount: number;
  replies: IReply[];
}

export interface IDiscussion {
  id: string;
  url: string;
  locked: boolean;
  repository: { nameWithOwner: string };
  totalCommentCount: number;
  totalReplyCount: number;
  reactionCount: number;
  reactions: IReactionGroups;
  pageInfo: { startCursor: string; endCursor: string; hasNextPage: boolean; hasPreviousPage: boolean };
  comments: IComment[];
}

export interface IGiscussion {
  viewer: IUser | null;
  discussion: IDiscussion | null;
}

const GhostUser: IUser = {
  avatarUrl: "https://avatars.githubusercontent.com/u/10137?s=64&v=4",
  login: "ghost",
  url: "https://github.com/ghost",
};

function adaptReactionGroups(groups: any[]): IReactionGroups {
  const base = Object.fromEntries(REACTIONS.map((c) => [c, { count: 0, viewerHasReacted: false }])) as IReactionGroups;
  for (const g of groups ?? []) {
    base[g.content as ReactionContent] = { count: g.users.totalCount, viewerHasReacted: g.viewerHasReacted };
  }
  return base;
}

function adaptReply(reply: any): IReply {
  const { reactionGroups, replyTo, author, ...rest } = reply;
  return { ...rest, author: author || GhostUser, reactions: adaptReactionGroups(reactionGroups), replyToId: replyTo?.id };
}

function adaptComment(comment: any): IComment {
  const { replies, reactionGroups, author, ...rest } = comment;
  return {
    ...rest,
    author: author || GhostUser,
    reactions: adaptReactionGroups(reactionGroups),
    replyCount: replies?.totalCount ?? 0,
    replies: (replies?.nodes ?? []).map(adaptReply),
  };
}

export function adaptDiscussion(viewer: any, discussion: any): IGiscussion {
  if (!discussion) return { viewer: viewer || null, discussion: null };
  const { comments, reactions, reactionGroups, ...rest } = discussion;
  const totalReplyCount = (comments.nodes ?? []).reduce((acc: number, c: any) => acc + (c.replies?.totalCount ?? 0), 0);
  return {
    viewer: viewer || null,
    discussion: {
      ...rest,
      totalCommentCount: comments.totalCount,
      totalReplyCount,
      pageInfo: comments.pageInfo,
      reactionCount: reactions.totalCount,
      reactions: adaptReactionGroups(reactionGroups),
      comments: (comments.nodes ?? []).map(adaptComment),
    },
  };
}
