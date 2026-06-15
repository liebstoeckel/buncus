// iframe -> parent messages. Envelope is always { buncus: <payload> }.

// targetOrigin is required (no "*" default) so callers must decide explicitly —
// sensitive payloads (metadata) must target a known origin (security-report L).
export function emit(payload: Record<string, unknown>, targetOrigin: string) {
  window.parent.postMessage({ buncus: payload }, targetOrigin);
}

export const reactionEmoji: Record<string, string> = {
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
  LAUGH: "😄",
  HOORAY: "🎉",
  CONFUSED: "😕",
  HEART: "❤️",
  ROCKET: "🚀",
  EYES: "👀",
};
