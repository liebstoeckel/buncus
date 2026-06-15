// The iframe document. Static HTML shell: theme link (no-flash) + base target
// + the React app bundle. All widget config travels in the URL query (set by
// the loader), so the app reads it client-side — no per-request SSR needed.

import { type Config, getConfig, isAllowedOrigin } from "../config.ts";
import { BUILTIN_THEMES } from "./assets.ts";

/**
 * Resolve the theme stylesheet href (M4):
 *  - a built-in name        -> /themes/<name>.css
 *  - a same-origin "/path"  -> allowed as-is
 *  - an external http(s) URL-> only if its origin is in cfg.themeOrigins
 *  - anything else          -> the safe default
 */
function resolveThemeHref(theme: string, cfg: Config): string {
  if (BUILTIN_THEMES.includes(theme as any)) return `/themes/${theme}.css`;
  if (theme.startsWith("/") && !theme.startsWith("//")) return theme;
  if (/^https?:\/\//.test(theme)) {
    try {
      if (cfg.themeOrigins.includes(new URL(theme).origin)) return theme;
    } catch {
      /* fall through */
    }
  }
  return "/themes/preferred_color_scheme.css";
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** CSP frame-ancestors (M6): empty allowlist = embeddable anywhere; otherwise
 *  only matching origins, and 'none' for absent/malformed/unmatched. */
function frameAncestors(originParam: string, cfg: Config): string {
  if (cfg.origins.length === 0 && cfg.originsRegex.length === 0) return "*";
  let origin: string;
  try {
    origin = new URL(originParam).origin;
  } catch {
    return "'none'";
  }
  return isAllowedOrigin(origin, cfg) ? `'self' ${origin}` : "'none'";
}

export function renderWidget(url: URL): Response {
  const cfg = getConfig();
  const theme = url.searchParams.get("theme") ?? "preferred_color_scheme";
  const originParam = url.searchParams.get("origin") ?? "";
  const themeHref = resolveThemeHref(theme, cfg);
  const external = /^https?:\/\//.test(themeHref);

  const styleSrc = ["'self'", ...cfg.themeOrigins].join(" ");
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    `style-src ${styleSrc}`,
    "img-src https: data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors(originParam, cfg)}`,
  ].join("; ");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base target="_top">
  <meta name="color-scheme" content="light dark">
  <title>Comments</title>
  <link rel="stylesheet" href="/widget.css">
  <link rel="stylesheet" id="buncus-theme" href="${escapeAttr(themeHref)}"${external ? ' crossorigin="anonymous"' : ""}>
</head>
<body>
  <div id="buncus-root"><div class="bc-status">Loading comments…</div></div>
  <script type="module" src="/widget.js"></script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
