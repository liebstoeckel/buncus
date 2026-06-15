# buncus

A single self-contained binary that hosts [GitHub Discussions](https://docs.github.com/discussions)
comments on your site. It's a Bun-native, themeable, GDPR-by-default reimplementation
of [giscus](https://giscus.app). Comments live in GitHub Discussions; buncus is the
hosting, proxy, and UI layer in front of them. No Node, no `node_modules`, no
database, no CDN.

> **Status: experimental, pre-1.0.** This is a mostly vibe-coded experiment built
> for internal use cases, and is not production ready. Before 1.0, breaking
> changes can land in any release without a major-version bump, so pin an exact
> version if you depend on it.

## Documentation map

| Doc | What it covers |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The as-built architecture, data/auth flows, and the design-decision log (rationale, alternatives, status). Start here. |
| [`SPEC.md`](./SPEC.md) | The original pre-implementation plan plus the giscus reverse-engineering notes. It diverges from what was actually built; see ARCHITECTURE §9. |
| [`packages/buncus/README.md`](./packages/buncus/README.md) | Operator/usage: quick start, env vars, embed attributes, theming, dev/test. |
| [`packages/buncus/MIGRATION.md`](./packages/buncus/MIGRATION.md) | Migrating an existing giscus embed to buncus (deviations, attribute map, theme map). |
| [`packages/mock-github/README.md`](./packages/mock-github/README.md) · [`SCHEMAS.md`](./packages/mock-github/SCHEMAS.md) | The GitHub mock used to build and test offline, and how its shapes are grounded in GitHub's API. |

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
bun test packages                         # 82 tests, all offline via @liebstoeckel/buncus-mock-github
bun run --cwd packages/buncus demo        # live local demo (mock + binary + host page)
```

To run against real GitHub you need a registered GitHub App; see
[`MIGRATION.md`](./packages/buncus/MIGRATION.md) §Step 1. Everything else (build,
test, demo) runs with no GitHub access.

## Status

Functioning and tested (unit, integration, render, loader-DOM, Playwright e2e, and
binary smoke), with the single binary verified end to end against the mock.

## License & attribution

buncus is [MIT licensed](./LICENSE).

It is a reimplementation of [giscus](https://github.com/giscus/giscus) by
Sage M. Abdullah and contributors, and it reuses code from giscus: the GitHub
GraphQL queries, parts of the client/proxy architecture, and the `data-*` embed
model. giscus is MIT licensed, and its notice is reproduced in [`LICENSE`](./LICENSE).
