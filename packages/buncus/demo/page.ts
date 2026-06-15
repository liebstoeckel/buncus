// Renders the demo host page (demo/index.html) with the live origin + repo IDs
// substituted in. Shared by scripts/demo.ts and the e2e test.

// Read the template from disk (demo-only; not embedded in the server binary).
const templatePath = new URL("./index.html", import.meta.url).pathname;

export interface DemoOptions {
  origin: string; // buncus origin (where buncus.js + the widget are served)
  repoId: string;
  categoryId: string;
  theme?: string;
}

export async function renderDemoPage(opts: DemoOptions): Promise<string> {
  const html = await Bun.file(templatePath).text();
  return html
    .replaceAll("{{origin}}", opts.origin)
    .replaceAll("{{repoId}}", opts.repoId)
    .replaceAll("{{categoryId}}", opts.categoryId)
    .replaceAll("{{theme}}", opts.theme ?? "preferred_color_scheme");
}
