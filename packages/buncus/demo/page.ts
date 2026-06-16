// Renders the demo host page (demo/index.html) with the live origin + repo IDs
// substituted in. Shared by scripts/demo.ts and the e2e test.

// Read the template from disk (demo-only; not embedded in the server binary).
const templatePath = new URL("./index.html", import.meta.url).pathname;

export interface DemoOptions {
  origin: string; // buncus origin (where buncus.js + the widget are served)
  repoId: string;
  categoryId: string;
  theme?: string;
  // The embed target. Default to the seeded mock values so the mock demo and
  // the e2e test keep working unchanged; scripts/demo-live.ts overrides them to
  // point at a real repo.
  repo?: string;
  category?: string;
  mapping?: string;
  term?: string;
  consent?: string;
}

export async function renderDemoPage(opts: DemoOptions): Promise<string> {
  const html = await Bun.file(templatePath).text();
  return html
    .replaceAll("{{origin}}", opts.origin)
    .replaceAll("{{repoId}}", opts.repoId)
    .replaceAll("{{categoryId}}", opts.categoryId)
    .replaceAll("{{theme}}", opts.theme ?? "preferred_color_scheme")
    .replaceAll("{{repo}}", opts.repo ?? "acme/docs")
    .replaceAll("{{category}}", opts.category ?? "General")
    .replaceAll("{{mapping}}", opts.mapping ?? "specific")
    .replaceAll("{{term}}", opts.term ?? "guide/start")
    .replaceAll("{{consent}}", opts.consent ?? "required");
}
