import { describe, test, expect } from "bun:test";
import { buildIframeTarget, buildWidgetUrl, consentDecision, resolveMapping, type LoaderInputs } from "../loader/params.ts";

function inputs(over: Partial<LoaderInputs> = {}): LoaderInputs {
  return {
    dataset: { repo: "acme/docs", repoId: "R_1", categoryId: "DIC_1", ...(over.dataset ?? {}) },
    location: "http://site/blog/post.html",
    pathname: "/blog/post.html",
    meta: (n) => (n === "description" ? "desc" : ""),
    session: "sess",
    ...over,
  };
}

describe("loader mapping (giscus-compatible)", () => {
  test("pathname strips leading slash + extension", () => {
    expect(resolveMapping({ mapping: "pathname" }, inputs())).toEqual({ term: "blog/post" });
  });
  test("root pathname becomes 'index'", () => {
    expect(resolveMapping({ mapping: "pathname" }, inputs({ pathname: "/" }))).toEqual({ term: "index" });
  });
  test("url uses the cleaned location", () => {
    expect(resolveMapping({ mapping: "url" }, inputs()).term).toBe("http://site/blog/post.html");
  });
  test("specific uses data-term", () => {
    expect(resolveMapping({ mapping: "specific", term: "my-key" }, inputs()).term).toBe("my-key");
  });
  test("number sets number, not term", () => {
    expect(resolveMapping({ mapping: "number", term: "42" }, inputs())).toEqual({ number: "42" });
  });
});

describe("loader iframe target", () => {
  test("builds the param set with defaults", () => {
    const t = buildIframeTarget(inputs());
    expect(t.locale).toBe("");
    expect(t.params).toMatchObject({
      repo: "acme/docs",
      repoId: "R_1",
      categoryId: "DIC_1",
      session: "sess",
      theme: "preferred_color_scheme",
      reactionsEnabled: "1",
      inputPosition: "bottom",
      term: "blog/post",
    });
  });

  test("lang becomes a path segment", () => {
    const t = buildIframeTarget(inputs({ dataset: { repo: "a/b", lang: "de" } }));
    expect(t.locale).toBe("/de");
  });

  test("widget url is well-formed", () => {
    const t = buildIframeTarget(inputs());
    const url = new URL(buildWidgetUrl("http://buncus.test", t));
    expect(url.pathname).toBe("/widget");
    expect(url.searchParams.get("repo")).toBe("acme/docs");
  });
});

describe("consent decision (GDPR gate)", () => {
  test("gates by default", () => {
    expect(consentDecision(undefined, null)).toBe("gate");
  });
  test("loads when remembered", () => {
    expect(consentDecision(undefined, "granted")).toBe("load");
  });
  test("data-consent=skip loads immediately", () => {
    expect(consentDecision("skip", null)).toBe("load");
  });
});
