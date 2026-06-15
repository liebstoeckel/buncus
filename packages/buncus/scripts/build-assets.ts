#!/usr/bin/env bun
// Bundle the browser assets that the server embeds:
//   loader/buncus.ts            -> dist/buncus.js   (classic IIFE, the embed script)
//   src/client/widget.client.tsx-> dist/widget.js   (ESM, the iframe React app)
// Run before `bun build --compile` so the binary embeds the built JS.

import { rmSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;

async function build(entry: string, out: string, format: "iife" | "esm") {
  const result = await Bun.build({
    entrypoints: [`${root}${entry}`],
    minify: true,
    target: "browser",
    format,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Build failed for ${entry}`);
  }
  await Bun.write(`${root}dist/${out}`, await result.outputs[0].text());
  console.log(`built dist/${out} (${(result.outputs[0].size / 1024).toFixed(1)} kB)`);
}

try {
  rmSync(`${root}dist/buncus.js`, { force: true });
  rmSync(`${root}dist/widget.js`, { force: true });
} catch {}

await build("loader/buncus.ts", "buncus.js", "iife");
await build("src/client/widget.client.tsx", "widget.js", "esm");
