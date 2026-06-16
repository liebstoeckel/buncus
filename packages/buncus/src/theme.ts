// Theme resolution shared by the server shell (`routes/widget.ts`) and the
// client runtime swap (`client/components/App.tsx`), so the allowlist semantics
// are defined once and can't drift between load-time and runtime.
//
// This module must stay dependency-light: it is imported into the client bundle,
// so it MUST NOT pull in server-only modules (notably `routes/assets.ts`, whose
// `with { type: "file" }` asset imports would break the client build). It is the
// single source of truth for BUILTIN_THEMES for that reason.

export const BUILTIN_THEMES = ["light", "dark", "preferred_color_scheme"] as const;

/**
 * The stylesheet href a theme value resolves to, or `null` if the value is not
 * acceptable. Acceptable values:
 *  - a built-in name        -> /themes/<name>.css
 *  - a same-origin "/path"  -> the path as-is (but never protocol-relative "//")
 *  - an external http(s) URL-> the URL, only if its origin is in `themeOrigins`
 *
 * Callers decide what to do with `null`: the server falls back to a safe default
 * stylesheet; the client ignores the swap and keeps the current theme.
 */
export function resolveThemeHref(theme: string, themeOrigins: readonly string[]): string | null {
  if ((BUILTIN_THEMES as readonly string[]).includes(theme)) return `/themes/${theme}.css`;
  if (theme.startsWith("/") && !theme.startsWith("//")) return theme;
  if (/^https?:\/\//.test(theme)) {
    try {
      if (themeOrigins.includes(new URL(theme).origin)) return theme;
    } catch {
      /* malformed URL: fall through to reject */
    }
  }
  return null;
}
