import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactionContent } from "../../github/graphql.ts";
import { type CustomError, createDiscussion, postComment, postReply, react } from "../api.ts";
import type { WidgetConfig } from "../config.ts";
import { documentLang, makeT } from "../i18n.ts";
import { emit } from "../messages.ts";
import { type CommentOrder, useFrontBackDiscussion } from "../useFrontBackDiscussion.ts";
import { Comment } from "./Comment.tsx";
import { CommentBox } from "./CommentBox.tsx";
import { Reactions } from "./Reactions.tsx";

export function App({ config }: { config: WidgetConfig }) {
  const [orderBy, setOrderBy] = useState<CommentOrder>("oldest");
  const [actionError, setActionError] = useState("");
  const d = useFrontBackDiscussion(config, orderBy);
  const { discussion, viewer, status } = d;
  const signedIn = !!config.session;
  // UI strings for the iframe's locale (set on <html lang> by the server).
  const t = useMemo(() => makeT(documentLang()), []);
  // The embedding page's origin (for postMessage targeting + inbound checks).
  const parentOrigin = useMemo(() => {
    try {
      return config.origin ? new URL(config.origin).origin : "*";
    } catch {
      return "*";
    }
  }, [config.origin]);
  const BUILTIN_THEMES = ["light", "dark", "preferred_color_scheme"];

  // Forward fatal load errors to the parent page (as the old single-fetch path
  // did): the loader clears a stale session on "Bad credentials" and warns on
  // rate-limit, so it must hear about read failures over postMessage.
  useEffect(() => {
    if (status === "error" && d.error) emit({ error: d.error }, parentOrigin);
  }, [status, d.error, parentOrigin]);

  // Resize the iframe to fit content. (Height is non-sensitive; "*" is fine when
  // the parent origin is unknown so the iframe can still be sized.)
  useEffect(() => {
    const send = () =>
      emit({ resizeHeight: Math.ceil(document.documentElement.getBoundingClientRect().height) }, parentOrigin);
    const ro = new ResizeObserver(send);
    ro.observe(document.documentElement);
    send();
    return () => ro.disconnect();
  });

  // Optional metadata broadcast — only to a KNOWN origin (never "*"), since it
  // includes the viewer's login (security-report L). Mirrors giscus' shape:
  // discussion metadata + counts, never the comment bodies.
  useEffect(() => {
    if (!config.emitMetadata || !discussion || parentOrigin === "*") return;
    const metadata = {
      ...discussion,
      totalCommentCount: d.totalCommentCount,
      totalReplyCount: d.totalReplyCount,
    };
    emit({ discussion: metadata, viewer }, parentOrigin);
  }, [config.emitMetadata, parentOrigin, discussion, viewer, d.totalCommentCount, d.totalReplyCount]);

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
  }, [parentOrigin, BUILTIN_THEMES.includes]);

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
        setActionError("");
        await fn();
        await d.reload();
      } catch (e) {
        const err = e as CustomError;
        setActionError(err.message);
        emit({ error: err.message }, parentOrigin);
      }
    },
    [d.reload, parentOrigin],
  );

  const onComment = (body: string) =>
    guard(async () => void (await postComment(config.session, await ensureId(), body)));
  const onReply = (replyToId: string, body: string) =>
    guard(async () => void (await postReply(config.session, await ensureId(), replyToId, body)));
  const onReact = (subjectId: string, content: ReactionContent, viewerHasReacted: boolean) =>
    guard(async () => void (await react(config.session, subjectId, content, viewerHasReacted)));

  if (status === "loading") return <div className="bc-status">{t.loadingComments}</div>;
  if (status === "error") return <div className="bc-status bc-status--error">{d.error}</div>;

  const count = d.totalCommentCount;
  const box = (
    <CommentBox
      t={t}
      signedIn={signedIn}
      placeholder={signedIn ? t.writeAComment : t.signInToComment}
      onSignIn={signIn}
      onSignOut={signedIn ? signOut : undefined}
      onSubmit={onComment}
    />
  );

  const renderComment = (c: (typeof d.frontComments)[number]) => (
    <Comment key={c.id} t={t} comment={c} signedIn={signedIn} onReact={onReact} onReply={onReply} onSignIn={signIn} />
  );

  const pagination = d.numHidden > 0 && (
    <button type="button" className="bc-pagination" onClick={d.loadMore} disabled={d.isLoadingMore}>
      <span className="bc-pagination__count">{t.hiddenItems(d.numHidden)}</span>
      <span className="bc-pagination__more">{`${d.isLoadingMore ? t.loading : t.loadMore}…`}</span>
    </button>
  );

  return (
    <div className="bc-root" data-input-position={config.inputPosition}>
      {config.reactionsEnabled && discussion && (
        <Reactions
          t={t}
          reactions={discussion.reactions}
          disabled={!signedIn}
          onReact={(c, v) => onReact(discussion.id, c, v)}
        />
      )}

      <header className="bc-header">
        <span className="bc-header__count">{t.comments(count)}</span>
        <div className="bc-header__actions">
          {count > 0 && (
            <div className="bc-order">
              <button
                type="button"
                className={`bc-order__btn${orderBy === "oldest" ? " bc-order__btn--active" : ""}`}
                aria-pressed={orderBy === "oldest"}
                onClick={() => setOrderBy("oldest")}
              >
                {t.oldest}
              </button>
              <button
                type="button"
                className={`bc-order__btn${orderBy === "newest" ? " bc-order__btn--active" : ""}`}
                aria-pressed={orderBy === "newest"}
                onClick={() => setOrderBy("newest")}
              >
                {t.newest}
              </button>
            </div>
          )}
          {discussion && (
            <a className="bc-header__link" href={discussion.url} target="_top" rel="noopener noreferrer">
              {t.viewOnGitHub}
            </a>
          )}
        </div>
      </header>

      {config.inputPosition === "top" && box}

      <div className="bc-comments">
        {d.frontComments.map(renderComment)}
        {pagination}
        {d.backComments.map(renderComment)}
        {count === 0 && <p className="bc-empty">{t.noComments}</p>}
      </div>

      {config.inputPosition === "bottom" && box}

      {(actionError || d.error) && <div className="bc-status bc-status--error">{actionError || d.error}</div>}
    </div>
  );
}
