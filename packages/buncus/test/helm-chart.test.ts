// Guards the Helm chart against drifting from the runtime env contract: every
// env var that config.ts reads must be represented somewhere in the chart
// (rendered env, the inline Secret keys, or the documented values table). If a
// new var is added to config.ts and not surfaced in the chart, this fails.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const configSrc = readFileSync(join(here, "../src/config.ts"), "utf8");
const chartDir = join(here, "../../../charts/buncus");

// Every env var config.ts consults, however it reads it: directly via
// `process.env.X` / `process.env["X"]`, or by name through `required("X")` /
// `jsonArray("X")`.
function envNames(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]!);
  for (const m of src.matchAll(/process\.env\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g)) names.add(m[1]!);
  for (const m of src.matchAll(/(?:required|jsonArray)\(\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/g)) names.add(m[1]!);
  return [...names].sort();
}

function readTree(dir: string): string {
  let out = "";
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out += readTree(p);
    else out += `${readFileSync(p, "utf8")}\n`;
  }
  return out;
}

describe("helm chart / config.ts parity", () => {
  const names = envNames(configSrc);
  const chartText = readTree(chartDir);

  test("config.ts exposes a non-trivial env contract", () => {
    // Sanity: the extraction works (guards against a regex that silently matches nothing).
    expect(names).toContain("GITHUB_APP_ID");
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  test("the chart covers every env var config.ts reads", () => {
    const missing = names.filter((n) => !chartText.includes(n));
    expect(missing).toEqual([]);
  });
});
