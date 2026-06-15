// Widget runtime config, read from the iframe URL query (set by the loader).

export interface WidgetConfig {
  repo: string;
  repoId: string;
  category: string;
  categoryId: string;
  term: string;
  number: number;
  strict: boolean;
  session: string;
  origin: string; // the embedding page URL (for OAuth return + back-link)
  backLink: string;
  description: string;
  theme: string;
  reactionsEnabled: boolean;
  inputPosition: "top" | "bottom";
  emitMetadata: boolean;
}

export function readConfig(search = window.location.search): WidgetConfig {
  const q = new URLSearchParams(search);
  return {
    repo: q.get("repo") ?? "",
    repoId: q.get("repoId") ?? "",
    category: q.get("category") ?? "",
    categoryId: q.get("categoryId") ?? "",
    term: q.get("term") ?? "",
    number: Number(q.get("number") ?? 0),
    strict: q.get("strict") === "1" || q.get("strict") === "true",
    session: q.get("session") ?? "",
    origin: q.get("origin") ?? "",
    backLink: q.get("backLink") ?? "",
    description: q.get("description") ?? "",
    theme: q.get("theme") ?? "preferred_color_scheme",
    reactionsEnabled: (q.get("reactionsEnabled") ?? "1") !== "0",
    inputPosition: q.get("inputPosition") === "top" ? "top" : "bottom",
    emitMetadata: q.get("emitMetadata") === "1",
  };
}
