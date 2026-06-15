import { useCallback, useEffect, useMemo, useState } from "react";
import type { IDiscussion, IUser } from "../../github/adapters.ts";
import type { ReactionContent } from "../../github/graphql.ts";
import type { WidgetConfig } from "../config.ts";
import { CustomError, createDiscussion, fetchDiscussion, postComment, postReply, react } from "../api.ts";
import { emit } from "../messages.ts";
import { Comment } from "./Comment.tsx";
import { CommentBox } from "./CommentBox.tsx";
import { Reactions } from "./Reactions.tsx";

type Status = "loading" | "ready" | "notfound" | "error";

export function App({ config }: { config: WidgetConfig }) {
  const [discussion, setDiscussion] = useState<IDiscussion | null>(null);
  const [viewer, setViewer] = useState<IUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const signedIn = !!config.session;
  // The embedding page's origin (for postMessage targeting + inbound checks).
  const parentOrigin = useMemo(() => {
    try {
      return config.origin ? new URL(config.origin).origin : "*";
    } catch {
      return "*";
    }
  }, [config.origin]);
  const BUILTIN_THEMES = ["light", "dark", "preferred_color_scheme"];

  const load = useCallback(async () => {
    try {
      const data = await fetchDiscussion(config);
      setDiscussion(data.discussion);
      setViewer(data.viewer);
      setStatus("ready");
    } catch (e) {
      const err = e as CustomError;
      if (err.status === 404) {
        setStatus("notfound");
      } else {
        setError(err.message);
        setStatus("error");
        emit({ error: err.message }, parentOrigin);
      }
    }
  }, [config, parentOrigin]);

  useEffect(() => {
    load();
  }, [load]);

  // Resize the iframe to fit content. (Height is non-sensitive; "*" is fine when
  // the parent origin is unknown so the iframe can still be sized.)
  useEffect(() => {
    const send = () => emit({ resizeHeight: Math.ceil(document.documentElement.getBoundingClientRect().height) }, parentOrigin);
    const ro = new ResizeObserver(send);
    ro.observe(document.documentElement);
    send();
    return () => ro.disconnect();
  });

  // Optional metadata broadcast — only to a KNOWN origin (never "*"), since it
  // includes the viewer's login (security-report L).
  useEffect(() => {
    if (config.emitMetadata && discussion && parentOrigin !== "*") emit({ discussion, viewer }, parentOrigin);
  }, [config.emitMetadata, parentOrigin, discussion, viewer]);

  // Parent-driven theme swap (M3): require a matching, known parent origin and
  // restrict the value to built-in names or same-origin paths (no external CSS).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (parentOrigin === "*" || e.origin !== parentOrigin) return;
      const theme = e.data?.buncus?.setConfig?.theme;
      if (!theme || typeof theme !== "string") return;
      const link = document.getElementById("buncus-theme") as HTMLLinkElement | null;
      if (!link) return;
      if (BUILTIN_THEMES.includes(theme)) link.href = `/themes/${theme}.css`;
      else if (theme.startsWith("/") && !theme.startsWith("//")) link.href = theme;
      // external/unknown themes are ignored
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [parentOrigin]);

  const signIn = useCallback(() => {
    const url = `/api/oauth/authorize?redirect_uri=${encodeURIComponent(config.origin)}`;
    window.open(new URL(url, location.origin).href, "_top");
  }, [config.origin]);

  const signOut = useCallback(() => emit({ signOut: true }, parentOrigin), [parentOrigin]);

  const ensureId = useCallback(async (): Promise<string> => {
    if (discussion?.id) return discussion.id;
    const { id } = await createDiscussion(config);
    return id;
  }, [discussion, config]);

  const guard = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
        await load();
      } catch (e) {
        const err = e as CustomError;
        setError(err.message);
        emit({ error: err.message }, parentOrigin);
      }
    },
    [load, parentOrigin],
  );

  const onComment = (body: string) => guard(async () => void (await postComment(config.session, await ensureId(), body)));
  const onReply = (replyToId: string, body: string) =>
    guard(async () => void (await postReply(config.session, await ensureId(), replyToId, body)));
  const onReact = (subjectId: string, content: ReactionContent, viewerHasReacted: boolean) =>
    guard(async () => void (await react(config.session, subjectId, content, viewerHasReacted)));

  if (status === "loading") return <div className="bc-status">Loading comments…</div>;
  if (status === "error") return <div className="bc-status bc-status--error">{error}</div>;

  const count = discussion?.totalCommentCount ?? 0;
  const box = (
    <CommentBox
      signedIn={signedIn}
      placeholder={signedIn ? "Write a comment" : "Sign in to join the discussion."}
      onSignIn={signIn}
      onSignOut={signedIn ? signOut : undefined}
      onSubmit={onComment}
    />
  );

  return (
    <div className="bc-root" data-input-position={config.inputPosition}>
      {config.reactionsEnabled && discussion && (
        <Reactions reactions={discussion.reactions} disabled={!signedIn} onReact={(c, v) => onReact(discussion.id, c, v)} />
      )}

      <header className="bc-header">
        <span className="bc-header__count">
          {count} {count === 1 ? "comment" : "comments"}
        </span>
        {discussion && (
          <a className="bc-header__link" href={discussion.url} target="_top" rel="noopener noreferrer">
            View on GitHub
          </a>
        )}
      </header>

      {config.inputPosition === "top" && box}

      <div className="bc-comments">
        {discussion?.comments.map((c) => (
          <Comment key={c.id} comment={c} signedIn={signedIn} onReact={onReact} onReply={onReply} onSignIn={signIn} />
        ))}
        {count === 0 && <p className="bc-empty">No comments yet. Start the discussion!</p>}
      </div>

      {config.inputPosition === "bottom" && box}

      {error && <div className="bc-status bc-status--error">{error}</div>}
    </div>
  );
}
