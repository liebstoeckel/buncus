#!/usr/bin/env bun
// Generate THIRD_PARTY_LICENSES.txt for the compiled binary.
//
// The standalone binary embeds two kinds of third-party code:
//   1. the JS dependency closure bundled by `bun build --compile` (react,
//      react-dom, scheduler, ...), and
//   2. the Bun runtime itself, which statically links JavaScriptCore/WebKit
//      (LGPL), BoringSSL, zlib-ng, etc.
//
// This script collects (1) by resolving packages/buncus's *production* closure
// from node_modules and reading each package's license text, and (2) by
// fetching Bun's own LICENSE.md at the exact tag of the running Bun
// (`Bun.version`), which is the canonical bundled-dependency notice for the
// runtime. The two are concatenated into a single attributable report.
//
//   bun run scripts/third-party-licenses.ts            # -> dist/THIRD_PARTY_LICENSES.txt
//   bun run scripts/third-party-licenses.ts <out-path>

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const pkgRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const repoRoot = dirname(dirname(pkgRoot));
const outPath = process.argv[2] ?? join(pkgRoot, "dist", "THIRD_PARTY_LICENSES.txt");

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\..*)?$/i;
const ownScope = "@liebstoeckel/"; // workspace packages: not third-party

type Pkg = { name: string; version: string; license: string; dir: string };

// Resolve `name` to an installed package directory, preferring deps reachable
// from `fromDir` (Bun's isolated .bun store symlinks a package's own deps into
// its sibling node_modules), then falling back to a store-wide search.
function resolvePkg(name: string, fromDir: string | null): string | null {
  const candidates: string[] = [];
  if (fromDir) candidates.push(join(fromDir, "node_modules", name));
  candidates.push(join(pkgRoot, "node_modules", name));
  candidates.push(join(repoRoot, "node_modules", name));
  for (const c of candidates) {
    if (existsSync(join(c, "package.json"))) return c;
  }
  // Fall back to the flat .bun store: node_modules/.bun/<name>@<ver>/node_modules/<name>
  const store = join(repoRoot, "node_modules", ".bun");
  if (existsSync(store)) {
    const flat = name.replace("/", "+");
    for (const entry of readdirSync(store)) {
      if (entry === flat || entry.startsWith(`${flat}@`)) {
        const p = join(store, entry, "node_modules", name);
        if (existsSync(join(p, "package.json"))) return p;
      }
    }
  }
  return null;
}

function readLicenseText(dir: string): string {
  for (const f of readdirSync(dir)) {
    if (LICENSE_FILE.test(f) && statSync(join(dir, f)).isFile()) {
      return readFileSync(join(dir, f), "utf8").trimEnd();
    }
  }
  return "";
}

// Walk the production dependency closure starting from packages/buncus.
const root = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
const seen = new Map<string, Pkg>(); // name@version -> Pkg
const queue: Array<{ name: string; from: string | null }> = Object.keys(root.dependencies ?? {}).map((name) => ({
  name,
  from: pkgRoot,
}));

while (queue.length) {
  const { name, from } = queue.shift()!;
  if (name.startsWith(ownScope)) continue;
  const dir = resolvePkg(name, from);
  if (!dir) {
    console.warn(`warning: could not resolve ${name} (skipping)`);
    continue;
  }
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const key = `${meta.name}@${meta.version}`;
  if (seen.has(key)) continue;
  const license =
    meta.license ??
    (Array.isArray(meta.licenses) ? meta.licenses.map((l: { type?: string }) => l.type).join(" OR ") : "UNKNOWN");
  seen.set(key, { name: meta.name, version: meta.version, license, dir });
  // Recurse into runtime dependencies only (skip dev/peer/optional).
  for (const dep of Object.keys(meta.dependencies ?? {})) {
    queue.push({ name: dep, from: dir });
  }
}

const pkgs = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));

// Fetch the Bun runtime's bundled-dependency notice for the running version.
const bunVersion = Bun.version;
const bunUrl = `https://raw.githubusercontent.com/oven-sh/bun/bun-v${bunVersion}/LICENSE.md`;
const res = await fetch(bunUrl);
if (!res.ok) throw new Error(`failed to fetch Bun LICENSE.md (${res.status}) from ${bunUrl}`);
const bunLicense = (await res.text()).trimEnd();

const bar = "=".repeat(78);
const parts: string[] = [];
parts.push(
  "buncus - THIRD PARTY LICENSES",
  "",
  "This binary is compiled with Bun and embeds the third-party software listed",
  "below. Section 1 covers the bundled JavaScript dependencies; section 2 is the",
  "Bun runtime's own bundled-dependency notice (JavaScriptCore/WebKit, etc.).",
  "",
  bar,
  "1. BUNDLED JAVASCRIPT DEPENDENCIES",
  bar,
  "",
  ...pkgs.map((p) => `  - ${p.name}@${p.version} (${p.license})`),
  "",
);
for (const p of pkgs) {
  const text = readLicenseText(p.dir);
  parts.push(
    bar,
    `${p.name}@${p.version} - ${p.license}`,
    bar,
    "",
    text || "(no license file shipped in package; see SPDX identifier above)",
    "",
  );
}
parts.push(
  bar,
  `2. BUN RUNTIME (bun v${bunVersion}) - BUNDLED DEPENDENCIES`,
  bar,
  `Source: ${bunUrl}`,
  "",
  bunLicense,
  "",
);

await Bun.write(outPath, parts.join("\n"));
console.log(`wrote ${outPath} (${pkgs.length} JS deps + Bun v${bunVersion} runtime notice)`);
