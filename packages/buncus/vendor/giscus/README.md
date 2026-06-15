# Vendored giscus locale strings

This directory contains files copied **verbatim** from the
[giscus](https://github.com/giscus/giscus) project, used as the source for
buncus' widget UI translations.

- **Source:** https://github.com/giscus/giscus
- **Pinned commit:** `3d6430237108ca4ee3eb6a1a20595201c09c72d5`
- **Path upstream:** `locales/<lang>/common.json`, `i18n.fallbacks.json`
- **License:** MIT (see `LICENSE` in this directory) — © 2021 Sage M. Abdullah
  and contributors.

## Why it's vendored

`scripts/build-i18n.ts` reads these files to generate
`src/client/i18n.data.ts`. Vendoring (rather than cloning giscus or fetching
over the network at build time) keeps regeneration hermetic, offline, and
reproducible, and makes the upstream copy reviewable in version control.

## Updating

To refresh against a newer giscus release, replace the files here with the
matching upstream versions, update the pinned commit above, then run:

```
bun run build:i18n
```

Only `common.json` (the strings the widget renders) is consumed;
`i18n.fallbacks.json` is kept for reference (its mappings are mirrored in
`src/client/i18n.ts` and `loader/consent-i18n.ts`).
