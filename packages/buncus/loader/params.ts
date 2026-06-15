// Pure helpers for the loader — no DOM access, so they're unit-testable.
// These define the embed contract: how data-* attributes + the page map to the
// widget iframe URL. Kept attribute-compatible with giscus (data-repo, etc.).

export interface LoaderInputs {
  dataset: Record<string, string | undefined>;
  /** Cleaned page URL (no ?buncus / hash). */
  location: string;
  pathname: string;
  /** Resolve `<meta>` content: (name, allowOpenGraph). */
  meta: (name: string, og?: boolean) => string;
  session: string;
  /** Anchor id of an existing `.buncus`/`.giscus` container, if any. */
  anchorId?: string;
}

export interface IframeTarget {
  /** Path segment for language, e.g. "/de" or "". */
  locale: string;
  /** Query params for /widget. */
  params: Record<string, string>;
}

/** Resolve the discussion term/number from the mapping mode (giscus-compatible). */
export function resolveMapping(dataset: Record<string, string | undefined>, inputs: LoaderInputs): { term?: string; number?: string } {
  switch (dataset.mapping) {
    case "url":
      return { term: inputs.location };
    case "title":
      return { term: inputs.meta("title") || "" };
    case "og:title":
      return { term: inputs.meta("title", true) };
    case "specific":
      return { term: dataset.term ?? "" };
    case "number":
      return { number: dataset.term ?? "" };
    case "pathname":
    default:
      return {
        term: inputs.pathname.length < 2 ? "index" : inputs.pathname.substring(1).replace(/\.\w+$/, ""),
      };
  }
}

export function buildIframeTarget(inputs: LoaderInputs): IframeTarget {
  const d = inputs.dataset;
  const params: Record<string, string> = {
    origin: inputs.anchorId ? `${inputs.location}#${inputs.anchorId}` : inputs.location,
    session: inputs.session,
    theme: d.theme ?? "preferred_color_scheme",
    reactionsEnabled: d.reactionsEnabled ?? "1",
    emitMetadata: d.emitMetadata ?? "0",
    inputPosition: d.inputPosition ?? "bottom",
    repo: d.repo ?? "",
    repoId: d.repoId ?? "",
    category: d.category ?? "",
    categoryId: d.categoryId ?? "",
    strict: d.strict ?? "0",
    description: inputs.meta("description", true),
    backLink: inputs.meta("buncus:backlink") || inputs.meta("giscus:backlink") || inputs.location,
  };
  const mapped = resolveMapping(d, inputs);
  if (mapped.term !== undefined) params.term = mapped.term;
  if (mapped.number !== undefined) params.number = mapped.number;

  return { locale: d.lang ? `/${d.lang}` : "", params };
}

export function buildWidgetUrl(origin: string, target: IframeTarget): string {
  return `${origin}${target.locale}/widget?${new URLSearchParams(target.params)}`;
}

/** Consent decision given the data-consent mode + any stored grant. */
export function consentDecision(mode: string | undefined, stored: string | null): "load" | "gate" {
  if (mode === "skip") return "load";
  if (stored === "granted") return "load";
  return "gate";
}
