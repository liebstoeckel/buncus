// Headless-DOM test of the loader: consent gate -> iframe injection, with no
// real browser. Uses happy-dom registered as the global environment.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({
  url: "http://site/blog/post.html",
  // We invoke boot() manually and only inspect the DOM; nothing should actually
  // load/navigate (no script exec, no iframe page load, no CSS fetch).
  settings: {
    handleDisabledFileLoadingAsSuccess: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    navigation: { disableChildFrameNavigation: true, disableMainFrameNavigation: true },
  },
});
const { boot } = await import("../loader/boot.ts");

function addScript(data: Record<string, string>): HTMLScriptElement {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  const s = document.createElement("script");
  s.src = "http://buncus.test/buncus.js";
  for (const [k, v] of Object.entries(data)) s.dataset[k] = v;
  document.body.appendChild(s);
  return s;
}

const base = { repo: "acme/docs", repoId: "R_1", categoryId: "DIC_1", mapping: "pathname" };

beforeEach(() => {
  localStorage.clear();
});

afterAll(async () => {
  await Bun.sleep(50); // let any happy-dom async tasks settle before teardown
  await GlobalRegistrator.unregister();
});

describe("loader in a DOM", () => {
  test("consent required: renders the gate, no iframe yet", () => {
    boot(addScript({ ...base }));
    expect(document.querySelector(".buncus-consent")).not.toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    // privacy + consent copy present
    expect(document.querySelector(".buncus-consent__load")?.textContent).toContain("Load comments");
  });

  test("clicking 'Load comments' injects the widget iframe with the right URL", () => {
    boot(addScript({ ...base, theme: "dark" }));
    (document.querySelector(".buncus-consent__load") as HTMLButtonElement).click();
    const iframe = document.querySelector("iframe.buncus-frame") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    const url = new URL(iframe.src);
    expect(url.origin).toBe("http://buncus.test");
    expect(url.pathname).toBe("/widget");
    expect(url.searchParams.get("repo")).toBe("acme/docs");
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.searchParams.get("term")).toBe("blog/post"); // pathname mapping
  });

  test("remembering consent persists and skips the gate next load", () => {
    boot(addScript({ ...base }));
    (document.querySelector(".buncus-consent__remember input") as HTMLInputElement).checked = true;
    (document.querySelector(".buncus-consent__load") as HTMLButtonElement).click();
    expect(localStorage.getItem("buncus-consent")).toBe("granted");

    // Second load → no gate, straight to iframe.
    boot(addScript({ ...base }));
    expect(document.querySelector(".buncus-consent")).toBeNull();
    expect(document.querySelector("iframe.buncus-frame")).not.toBeNull();
  });

  test("data-consent=skip loads immediately (giscus-like)", () => {
    boot(addScript({ ...base, consent: "skip" }));
    expect(document.querySelector(".buncus-consent")).toBeNull();
    expect(document.querySelector("iframe.buncus-frame")).not.toBeNull();
  });

  test("German consent copy when data-lang=de", () => {
    boot(addScript({ ...base, lang: "de" }));
    expect(document.querySelector(".buncus-consent__load")?.textContent).toContain("Kommentare laden");
  });

  test("injects the parent default.css link", () => {
    boot(addScript({ ...base, consent: "skip" }));
    const link = document.getElementById("buncus-css") as HTMLLinkElement;
    expect(link?.href).toBe("http://buncus.test/default.css");
  });
});
