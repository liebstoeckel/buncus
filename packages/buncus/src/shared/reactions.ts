// Reaction constants shared by server and client. Kept dependency-free (no
// config/node imports) so the browser bundle doesn't transitively pull in
// server-only modules.

export const REACTIONS = [
  "THUMBS_UP",
  "THUMBS_DOWN",
  "LAUGH",
  "HOORAY",
  "CONFUSED",
  "HEART",
  "ROCKET",
  "EYES",
] as const;

export type ReactionContent = (typeof REACTIONS)[number];
