// The iframe document. Static HTML shell: theme link (no-flash) + base target
// + the React app bundle. All widget config travels in the URL query (set by
// the loader), so the app reads it client-side — no per-request SSR needed.

import { isRtl, resolveStrings } from "../client/i18n.ts";
import { type Config, getConfig, isAllowedOrigin } from "../config.ts";
import { resolveThemeHref } from "../theme.ts";

const DEFAULT_THEME_HREF = "/themes/preferred_color_scheme.css";

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

export function renderWidget(url: URL, lang?: string): Response {
  const cfg = getConfig();
  const theme = url.searchParams.get("theme") ?? "preferred_color_scheme";
  const originParam = url.searchParams.get("origin") ?? "";
  // M4: a rejected value (null) falls back to the safe default at load time.
  const themeHref = resolveThemeHref(theme, cfg.themeOrigins) ?? DEFAULT_THEME_HREF;
  const external = /^https?:\/\//.test(themeHref);
  // Locale is presentational: it picks the UI strings + text direction. The
  // client reads the resolved <html lang>; the shell shows a matching loading
  // string so there's no English flash before the bundle runs.
  const t = resolveStrings(lang);
  const langAttr = lang ? ` lang="${escapeAttr(lang)}"${isRtl(lang) ? ' dir="rtl"' : ""}` : "";

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
<html${langAttr}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base target="_top">
  <meta name="color-scheme" content="light dark">
  <title>Comments</title>
  <link rel="stylesheet" href="/widget.css">
  <link rel="stylesheet" id="buncus-theme" href="${escapeAttr(themeHref)}" data-theme-origins="${escapeAttr(JSON.stringify(cfg.themeOrigins))}"${external ? ' crossorigin="anonymous"' : ""}>
</head>
<body>
  <div id="buncus-root"><div class="bc-status">${escapeAttr(t.loadingComments)}</div></div>
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
