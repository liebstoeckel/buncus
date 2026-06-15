# buncus

A **single self-contained binary** that hosts [GitHub Discussions](https://docs.github.com/discussions)
comments on your site — a Bun-native, themeable, GDPR-by-default reimplementation
of [giscus](https://giscus.app). Comments live in GitHub Discussions; buncus is
the hosting + proxy + UI layer. No Node, no `node_modules`, no database, no CDN.

## Documentation map

| Doc | What it covers |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | **As-built** architecture, data/auth flows, and the full **design-decision log** (rationale, alternatives, status). Start here. |
| [`SPEC.md`](./SPEC.md) | The original pre-implementation plan + the giscus reverse-engineering reference. (Diverges from as-built — see ARCHITECTURE §9.) |
| [`packages/buncus/README.md`](./packages/buncus/README.md) | Operator/usage: quick start, env vars, embed attributes, theming, dev/test. |
| [`packages/buncus/MIGRATION.md`](./packages/buncus/MIGRATION.md) | Migrating an existing giscus embed to buncus (deviations, attribute map, theme map). |
| [`packages/mock-github/README.md`](./packages/mock-github/README.md) · [`SCHEMAS.md`](./packages/mock-github/SCHEMAS.md) | The GitHub mock used to build/test offline, and how its shapes are grounded in GitHub's API. |

## Workspace layout

```
buncus/
├── ARCHITECTURE.md · SPEC.md · README.md
├── giscus-eval/                 reference clone of giscus/giscus (gitignored)
└── packages/
    ├── buncus/                  the server, loader, widget, themes, demo, tests
    └── mock-github/             stateful GitHub mock (OAuth/REST/GraphQL), no GitHub needed
```

## Quick start

```sh
bun install
bun run --cwd packages/buncus compile     # -> packages/buncus/dist/buncus (single binary)
bun test packages                         # 82 tests, all offline via @buncus/mock-github
bun run --cwd packages/buncus demo        # live local demo (mock + binary + host page)
```

To run against real GitHub you need a registered GitHub App — see
[`MIGRATION.md`](./packages/buncus/MIGRATION.md) §Step 1. Everything else (build,
test, demo) runs with **no GitHub access**.

## Status

Functioning, tested (unit · integration · render · loader-DOM · Playwright e2e ·
binary smoke), single binary verified end-to-end against the mock.

## License & attribution

buncus is [MIT licensed](./LICENSE).

It is a reimplementation of [**giscus**](https://github.com/giscus/giscus) by
Sage M. Abdullah and contributors, and incorporates code derived from it —
notably the GitHub GraphQL queries and parts of the client/proxy architecture
and `data-*` embed model. giscus is MIT licensed; its notice is reproduced in
[`LICENSE`](./LICENSE).
