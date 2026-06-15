// Widget i18n: resolve the locale (from the iframe's <html lang>) to a string
// table and expose a tiny translator. The string tables live in i18n.data.ts
// (generated from giscus's locale bundles); this file is the hand-written
// resolution + fallback logic, mirroring giscus's i18n.fallbacks.json.

import { WIDGET_I18N, type WidgetStrings } from "./i18n.data.ts";

// giscus alias locales that reuse another locale's strings.
const FALLBACKS: Record<string, string> = {
  gsw: "de",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
};

/** Locales written right-to-left. */
const RTL = new Set(["ar", "fa", "he"]);

/** Resolve the giscus `lang` value to a string table (exact → alias → base → en). */
export function resolveStrings(lang: string | undefined): WidgetStrings {
  if (lang) {
    const hit = WIDGET_I18N[lang] || WIDGET_I18N[FALLBACKS[lang]] || WIDGET_I18N[lang.split("-")[0]];
    if (hit) return hit;
  }
  return WIDGET_I18N.en;
}

export function isRtl(lang: string | undefined): boolean {
  if (!lang) return false;
  return RTL.has(lang) || RTL.has(lang.split("-")[0]);
}

export interface Translator extends WidgetStrings {
  /** The active BCP-47 locale tag (for Intl date formatting); "" if unset. */
  locale: string;
  /** Localized "{count} comment(s)" using giscus's one/other plural forms. */
  comments(count: number): string;
}

/** Build a translator for a locale. Spreads the raw strings so components can
 *  read `t.signOut` etc. directly, and adds the pluralizing `comments(n)`. */
export function makeT(lang: string | undefined): Translator {
  const s = resolveStrings(lang);
  return {
    ...s,
    locale: lang || "",
    comments: (count: number) => (count === 1 ? s.commentsOne : s.commentsOther).replace("{count}", String(count)),
  };
}

/** The widget's active locale, read from the iframe document's <html lang>. */
export function documentLang(): string {
  return (typeof document !== "undefined" && document.documentElement.lang) || "";
}
