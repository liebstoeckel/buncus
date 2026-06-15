import { useState } from "react";
import type { Translator } from "../i18n.ts";

export function CommentBox({
  t,
  signedIn,
  placeholder,
  submitLabel = t.comment,
  onSubmit,
  onSignIn,
  onSignOut,
}: {
  t: Translator;
  signedIn: boolean;
  placeholder: string;
  submitLabel?: string;
  onSubmit: (body: string) => Promise<void>;
  onSignIn: () => void;
  onSignOut?: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <div className="bc-box bc-box--signin">
        <span>{placeholder}</span>
        <button type="button" className="bc-btn bc-btn--primary" onClick={onSignIn}>
          {t.signInWithGitHub}
        </button>
      </div>
    );
  }

  return (
    <div className="bc-box">
      <textarea
        className="bc-textarea"
        placeholder={placeholder}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />
      <div className="bc-box__actions">
        {onSignOut && (
          <button type="button" className="bc-btn bc-btn--ghost" onClick={onSignOut}>
            {t.signOut}
          </button>
        )}
        <button type="button" className="bc-btn bc-btn--primary" disabled={busy || !value.trim()} onClick={submit}>
          {busy ? "…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
