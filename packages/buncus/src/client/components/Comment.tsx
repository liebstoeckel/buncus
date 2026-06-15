import { useState } from "react";
import type { IComment, IReply } from "../../github/adapters.ts";
import type { ReactionContent } from "../../github/graphql.ts";
import type { Translator } from "../i18n.ts";
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

function Meta({ comment, locale }: { comment: IComment | IReply; locale: string }) {
  const when = comment.createdAt ? new Date(comment.createdAt).toLocaleDateString(locale || undefined) : "";
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
  t,
  comment,
  signedIn,
  onReact,
  onReply,
  onSignIn,
}: {
  t: Translator;
  comment: IComment;
  signedIn: boolean;
  onReact: (subjectId: string, content: ReactionContent, viewerHasReacted: boolean) => void;
  onReply: (replyToId: string, body: string) => Promise<void>;
  onSignIn: () => void;
}) {
  const [replying, setReplying] = useState(false);

  return (
    <article className="bc-comment">
      <Meta comment={comment} locale={t.locale} />
      {comment.deletedAt || comment.isMinimized ? (
        <p className="bc-comment__hidden">{comment.deletedAt ? t.thisCommentWasDeleted : t.thisCommentWasMinimized}</p>
      ) : (
        <Body html={comment.bodyHTML} />
      )}
      <Reactions
        t={t}
        reactions={comment.reactions}
        disabled={!signedIn}
        onReact={(c, v) => onReact(comment.id, c, v)}
      />

      {comment.replies.length > 0 && (
        <div className="bc-replies">
          {comment.replies.map((reply) => (
            <div className="bc-reply" key={reply.id}>
              <Meta comment={reply} locale={t.locale} />
              <Body html={reply.bodyHTML} />
              <Reactions
                t={t}
                reactions={reply.reactions}
                disabled={!signedIn}
                onReact={(c, v) => onReact(reply.id, c, v)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="bc-comment__footer">
        <button type="button" className="bc-btn bc-btn--ghost" onClick={() => setReplying((r) => !r)}>
          {replying ? t.cancel : t.reply}
        </button>
      </div>
      {replying && (
        <CommentBox
          t={t}
          signedIn={signedIn}
          placeholder={t.writeAReply}
          submitLabel={t.reply}
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
