import { useState } from "react";
import type { IComment, IReply } from "../../github/adapters.ts";
import type { ReactionContent } from "../../github/graphql.ts";
import { CommentBox } from "./CommentBox.tsx";
import { Reactions } from "./Reactions.tsx";

function Body({ html }: { html: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: GitHub returns pre-sanitised bodyHTML; trusted by design (see ARCHITECTURE.md "Security hardening").
  return <div className="bc-markdown" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />;
}

// Only allow http(s) in href/src sinks (React doesn't block `javascript:` in
// href). Real GitHub URLs always qualify; this guards an unvalidated sink.
function httpsOnly(url: string | undefined): string | undefined {
  return url && /^https?:\/\//.test(url) ? url : undefined;
}

function Meta({ comment }: { comment: IComment | IReply }) {
  const when = comment.createdAt ? new Date(comment.createdAt).toLocaleDateString() : "";
  return (
    <div className="bc-comment__meta">
      <img className="bc-avatar" src={httpsOnly(comment.author.avatarUrl)} alt="" width={32} height={32} />
      <a className="bc-comment__author" href={httpsOnly(comment.author.url)} target="_top" rel="noopener noreferrer">
        {comment.author.login}
      </a>
      <span className="bc-comment__date">{when}</span>
    </div>
  );
}

export function Comment({
  comment,
  signedIn,
  onReact,
  onReply,
  onSignIn,
}: {
  comment: IComment;
  signedIn: boolean;
  onReact: (subjectId: string, content: ReactionContent, viewerHasReacted: boolean) => void;
  onReply: (replyToId: string, body: string) => Promise<void>;
  onSignIn: () => void;
}) {
  const [replying, setReplying] = useState(false);

  return (
    <article className="bc-comment">
      <Meta comment={comment} />
      {comment.deletedAt || comment.isMinimized ? (
        <p className="bc-comment__hidden">This comment was {comment.deletedAt ? "deleted" : "hidden"}.</p>
      ) : (
        <Body html={comment.bodyHTML} />
      )}
      <Reactions reactions={comment.reactions} disabled={!signedIn} onReact={(c, v) => onReact(comment.id, c, v)} />

      {comment.replies.length > 0 && (
        <div className="bc-replies">
          {comment.replies.map((reply) => (
            <div className="bc-reply" key={reply.id}>
              <Meta comment={reply} />
              <Body html={reply.bodyHTML} />
              <Reactions reactions={reply.reactions} disabled={!signedIn} onReact={(c, v) => onReact(reply.id, c, v)} />
            </div>
          ))}
        </div>
      )}

      <div className="bc-comment__footer">
        <button type="button" className="bc-btn bc-btn--ghost" onClick={() => setReplying((r) => !r)}>
          {replying ? "Cancel" : "Reply"}
        </button>
      </div>
      {replying && (
        <CommentBox
          signedIn={signedIn}
          placeholder="Write a reply"
          submitLabel="Reply"
          onSignIn={onSignIn}
          onSubmit={async (body) => {
            await onReply(comment.id, body);
            setReplying(false);
          }}
        />
      )}
    </article>
  );
}
