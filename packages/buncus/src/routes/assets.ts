// Static asset serving. Assets are embedded into the binary via
// `with { type: "file" }` (Bun copies them into the standalone executable and
// hands back a path that Bun.file reads at runtime — works compiled or not).

import loaderJs from "../../dist/buncus.js" with { type: "file" };
import widgetJs from "../../dist/widget.js" with { type: "file" };
import widgetCss from "../../assets/widget.css" with { type: "file" };
import defaultCss from "../../assets/default.css" with { type: "file" };
import lightCss from "../../assets/themes/light.css" with { type: "file" };
import darkCss from "../../assets/themes/dark.css" with { type: "file" };
import preferredCss from "../../assets/themes/preferred_color_scheme.css" with { type: "file" };

const CACHE = "public, max-age=0, stale-while-revalidate=604800";

interface Asset {
  path: string;
  type: string;
}

const assets: Record<string, Asset> = {
  "/buncus.js": { path: loaderJs, type: "text/javascript; charset=utf-8" },
  "/widget.js": { path: widgetJs, type: "text/javascript; charset=utf-8" },
  "/widget.css": { path: widgetCss, type: "text/css; charset=utf-8" },
  "/default.css": { path: defaultCss, type: "text/css; charset=utf-8" },
  "/themes/light.css": { path: lightCss, type: "text/css; charset=utf-8" },
  "/themes/dark.css": { path: darkCss, type: "text/css; charset=utf-8" },
  "/themes/preferred_color_scheme.css": { path: preferredCss, type: "text/css; charset=utf-8" },
};

export const BUILTIN_THEMES = ["light", "dark", "preferred_color_scheme"] as const;

export async function serveAsset(pathname: string): Promise<Response | null> {
  const asset = assets[pathname];
  if (!asset) return null;
  return new Response(Bun.file(asset.path), {
    headers: {
      "content-type": asset.type,
      "cache-control": CACHE,
      // Public embed assets are loaded cross-origin (the loader <script> uses
      // crossorigin="anonymous"); allow it like giscus.app does.
      "access-control-allow-origin": "*",
    },
  });
}
