// The embed loader entry. A site includes:
//   <script src="https://buncus.example/buncus.js" data-repo="o/n" data-repo-id="…" …></script>
//
// Must be a CLASSIC script (not a module) so `document.currentScript` resolves —
// that's how the loader discovers its own origin. Bundled as an IIFE.

import { boot } from "./boot.ts";

const script = document.currentScript as HTMLScriptElement | null;
if (script) boot(script);
