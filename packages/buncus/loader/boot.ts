// The loader's bootable logic, factored out of the IIFE entry so it can be
// driven in a headless DOM test. `buncus.ts` calls boot(document.currentScript).

import { isRtlLocale, resolveConsentCopy } from "./consent-i18n.ts";
import { buildIframeTarget, buildWidgetUrl, consentDecision, type LoaderInputs } from "./params.ts";

const SESSION_KEY = "buncus-session";
const CONSENT_KEY = "buncus-consent";

export function boot(script: HTMLScriptElement): void {
  const origin = new URL(script.src).origin;
  const d = script.dataset as Record<string, string | undefined>;

  // ---- session bootstrap (OAuth return) -----------------------------------
  // The session arrives in the URL *fragment* (#buncus=…), not the query, so it
  // never hits servers or Referer (C1). We read it, then scrub the fragment.
  const url = new URL(location.href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  let session = fragment.get("buncus") || "";
  const saved = localStorage.getItem(SESSION_KEY);
  url.searchParams.delete("buncus"); // tidy any legacy query param too
  url.hash = "";
  const cleaned = url.toString();
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    history.replaceState(undefined, document.title, cleaned);
  } else if (saved) {
    try {
      session = JSON.parse(saved);
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  const meta = (name: string, og = false): string => {
    const sel = `${og ? `meta[property='og:${name}'],` : ""}meta[name='${name}']`;
    return document.querySelector<HTMLMetaElement>(sel)?.content ?? "";
  };

  const existing = document.querySelector<HTMLElement>(".buncus, .giscus");
  const inputs: LoaderInputs = {
    dataset: d,
    location: cleaned,
    pathname: location.pathname,
    meta,
    session,
    anchorId: existing?.id || undefined,
  };
  const target = buildIframeTarget(inputs);

  const container = ensureContainer(existing, script);
  injectParentCss(origin);

  if (consentDecision(d.consent, localStorage.getItem(CONSENT_KEY)) === "load") {
    mountIframe();
  } else {
    renderGate();
  }

  function mountIframe() {
    container.textContent = "";
    const iframe = document.createElement("iframe");
    iframe.className = "buncus-frame";
    iframe.title = "Comments";
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("allow", "clipboard-write");
    if (d.loading === "lazy") iframe.loading = "lazy";
    iframe.style.opacity = "0";
    iframe.src = buildWidgetUrl(origin, target);
    iframe.addEventListener("load", () => iframe.style.removeProperty("opacity"));
    container.appendChild(iframe);
    listen(iframe);
  }

  function renderGate() {
    const lang = d.consentLang || d.lang;
    const copy = resolveConsentCopy(lang);
    const text = d.consentText || copy.text;
    const loadLabel = copy.load;
    const rememberLabel = copy.remember;

    // Built with DOM APIs (no innerHTML) so data-* values from the page can't
    // inject markup; the privacy URL is scheme-validated (http(s) or relative).
    const gate = document.createElement("div");
    gate.className = "buncus-consent";
    gate.setAttribute("role", "group");
    if (isRtlLocale(lang)) gate.dir = "rtl";

    const p = document.createElement("p");
    p.className = "buncus-consent__text";
    p.textContent = text;
    if (d.privacyUrl && /^(https?:\/\/|\/)/.test(d.privacyUrl)) {
      p.append(" ");
      const a = document.createElement("a");
      a.href = d.privacyUrl;
      a.target = "_top";
      a.rel = "noopener";
      a.style.color = "inherit";
      a.textContent = copy.privacy;
      p.append(a);
    }

    const actions = document.createElement("div");
    actions.className = "buncus-consent__actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "buncus-consent__load";
    button.textContent = loadLabel;
    const label = document.createElement("label");
    label.className = "buncus-consent__remember";
    const remember = document.createElement("input");
    remember.type = "checkbox";
    label.append(remember, ` ${rememberLabel}`);
    actions.append(button, label);
    gate.append(p, actions);

    button.addEventListener("click", () => {
      if (remember.checked) localStorage.setItem(CONSENT_KEY, "granted");
      mountIframe();
    });
    container.textContent = "";
    container.appendChild(gate);
  }

  function listen(iframe: HTMLIFrameElement) {
    window.addEventListener("message", (event) => {
      if (event.origin !== origin) return;
      const data = (event as MessageEvent).data;
      if (!data || typeof data !== "object" || !data.buncus) return;
      const msg = data.buncus;
      if (msg.resizeHeight) iframe.style.height = `${msg.resizeHeight}px`;
      if (msg.signOut) {
        localStorage.removeItem(SESSION_KEY);
        signOutReload(iframe);
        return;
      }
      if (msg.revokeConsent) {
        localStorage.removeItem(CONSENT_KEY);
        renderGate();
        return;
      }
      if (!msg.error) return;
      const e: string = msg.error;
      if (e.includes("Bad credentials") || e.includes("Invalid state value") || e.includes("State has expired")) {
        if (localStorage.getItem(SESSION_KEY) !== null) {
          localStorage.removeItem(SESSION_KEY);
          signOutReload(iframe);
        }
      } else if (e.includes("Discussion not found") || e.includes("API rate limit exceeded")) {
        console.warn(`[buncus] ${e}`);
      } else {
        console.error(`[buncus] ${e}`);
      }
    });
  }

  function signOutReload(iframe: HTMLIFrameElement) {
    delete target.params.session;
    iframe.src = buildWidgetUrl(origin, target);
  }
}

function ensureContainer(existing: HTMLElement | null, script: HTMLScriptElement): HTMLElement {
  if (existing) {
    existing.textContent = "";
    return existing;
  }
  const div = document.createElement("div");
  div.className = "buncus";
  script.insertAdjacentElement("afterend", div);
  return div;
}

function injectParentCss(origin: string) {
  const link = (document.getElementById("buncus-css") as HTMLLinkElement) || document.createElement("link");
  link.id = "buncus-css";
  link.rel = "stylesheet";
  link.href = `${origin}/default.css`;
  document.head.prepend(link);
}
