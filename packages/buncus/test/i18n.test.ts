import { describe, expect, test } from "bun:test";
import { WIDGET_I18N } from "../src/client/i18n.data.ts";
import { isRtl, makeT, resolveStrings } from "../src/client/i18n.ts";

const GISCUS_LOCALES =
  "ar be bg ca cs da de en eo es eu fa fr gr hbs he hu id it ja kh ko nl pl pt ro ru th tr uk uz vi zh-CN zh-HK zh-TW".split(
    " ",
  );

describe("widget i18n", () => {
  test("ships every giscus locale, fully populated", () => {
    expect(Object.keys(WIDGET_I18N).sort()).toEqual([...GISCUS_LOCALES].sort());
    for (const [code, s] of Object.entries(WIDGET_I18N)) {
      for (const [key, val] of Object.entries(s)) {
        if (key === "reaction") {
          expect(Object.keys(val).length).toBe(8);
        } else {
          expect(val, `${code}.${key}`).toBeTruthy();
        }
      }
    }
  });

  test("resolves exact, alias, base-language, and English fallbacks", () => {
    expect(resolveStrings("ja")).toBe(WIDGET_I18N.ja);
    expect(resolveStrings("gsw")).toBe(WIDGET_I18N.de); // giscus alias
    expect(resolveStrings("zh-Hant")).toBe(WIDGET_I18N["zh-TW"]);
    expect(resolveStrings("pt-BR")).toBe(WIDGET_I18N.pt); // base language
    expect(resolveStrings("xx")).toBe(WIDGET_I18N.en); // unknown
    expect(resolveStrings(undefined)).toBe(WIDGET_I18N.en);
  });

  test("pluralizes comment counts per locale", () => {
    const en = makeT("en");
    expect(en.comments(0)).toBe("0 comments");
    expect(en.comments(1)).toBe("1 comment");
    expect(en.comments(5)).toBe("5 comments");
    expect(makeT("de").comments(1)).toContain("1"); // localized, count interpolated
  });

  test("pluralizes hidden-item counts (front/back pagination button)", () => {
    const en = makeT("en");
    expect(en.hiddenItems(1)).toBe("1 hidden item");
    expect(en.hiddenItems(70)).toBe("70 hidden items");
  });

  test("flags RTL locales (and their base) only", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("fa")).toBe(true);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("fa-IR")).toBe(true);
    expect(isRtl("en")).toBe(false);
    expect(isRtl(undefined)).toBe(false);
  });
});
