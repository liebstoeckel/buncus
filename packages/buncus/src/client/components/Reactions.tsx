import type { IReactionGroups } from "../../github/adapters.ts";
import { REACTIONS, type ReactionContent } from "../../shared/reactions.ts";
import type { Translator } from "../i18n.ts";
import { reactionEmoji } from "../messages.ts";

export function Reactions({
  t,
  reactions,
  disabled,
  onReact,
}: {
  t: Translator;
  reactions: IReactionGroups;
  disabled?: boolean;
  onReact: (content: ReactionContent, viewerHasReacted: boolean) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: role="group" + aria-label is the correct pattern for a button group; <fieldset>/<legend> is form-specific and wrong here.
    <div className="bc-reactions" role="group" aria-label={t.reactionsLabel}>
      {REACTIONS.map((content) => {
        const r = reactions[content];
        const active = r.viewerHasReacted;
        return (
          <button
            key={content}
            type="button"
            className={`bc-reaction${active ? " bc-reaction--active" : ""}`}
            data-reaction={content}
            disabled={disabled}
            aria-pressed={active}
            title={t.reaction[content] ?? content.toLowerCase()}
            onClick={() => onReact(content, active)}
          >
            <span className="bc-reaction__emoji">{reactionEmoji[content]}</span>
            {r.count > 0 && <span className="bc-reaction__count">{r.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
