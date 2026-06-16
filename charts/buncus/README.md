# buncus Helm chart

Deploy [buncus](https://github.com/liebstoeckel/buncus), a self-hosted host for GitHub
Discussions comments, to Kubernetes. The chart renders a `Deployment` + `ClusterIP`
`Service` running the published `ghcr.io/liebstoeckel/buncus` image, with the full runtime
config surface exposed as values.

The chart version tracks the buncus image version: a pinned chart version implies an exact
image version. buncus is pre-1.0 and may ship breaking changes in any release, so pin an
exact version.

## Install

The chart is published as an OCI artifact on GHCR:

```sh
helm install buncus oci://ghcr.io/liebstoeckel/charts/buncus \
  --version <x.y.z> \
  -f my-values.yaml
```

`helm template oci://ghcr.io/liebstoeckel/charts/buncus --version <x.y.z> -f my-values.yaml`
renders the manifests without touching a cluster, so the chart drops cleanly into an ArgoCD
Helm source or a Kustomize `helmCharts:` inflation.

## Secrets

buncus needs five secrets (`GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`GITHUB_PRIVATE_KEY`, `ENCRYPTION_PASSWORD`) and refuses to boot without them. The chart
supplies them in one of two ways.

**By reference (recommended).** Point `secrets.existingSecret` at a Secret you manage
out of band (for example one materialized by External Secrets Operator). The chart loads it
via `envFrom` and renders no secret material itself:

```yaml
secrets:
  existingSecret: buncus-secrets
```

The referenced Secret's keys must be the literal env names: `GITHUB_APP_ID`,
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY`, `ENCRYPTION_PASSWORD`,
and optionally `GITHUB_WEBHOOK_SECRET`. Give buncus its own Secret so `envFrom` does not pull
in unrelated keys.

**Inline (convenience).** Leave `secrets.existingSecret` empty and set the `secrets.*`
values; the chart creates a Secret from the non-empty ones. Convenient for trying buncus out,
but keep real secrets out of values in production.

## Values

Each value maps to a buncus env var. Blank strings and empty lists mean "unset", so buncus'
own default applies.

| Value | Env var | Default | Notes |
|---|---|---|---|
| `config.publicUrl` | `BUNCUS_PUBLIC_URL` | `http://localhost:$PORT` | buncus' own base URL (OAuth callback + same-origin check). Set this in production. |
| `config.port` | `PORT` | `4600` | Listen port; also the container port and probe target. |
| `config.db` | `BUNCUS_DB` | `:memory:` | SQLite path for the token cache. Ignored when `persistence.enabled`. |
| `config.apiHost` | `GITHUB_API_HOST` | `https://api.github.com` | REST/GraphQL base (GHES / mock). |
| `config.oauthHost` | `GITHUB_OAUTH_HOST` | `https://github.com` | OAuth base (GHES / mock). |
| `config.sessionTtlDays` | `SESSION_TTL_DAYS` | `30` | Session lifetime in days. |
| `config.mock` | `BUNCUS_MOCK` | `false` | Relaxes secret validation; local/testing only. |
| `config.origins` | `ORIGINS` | `[]` | Embedding origins (YAML list, serialized to JSON). Gates the OAuth redirect, the API, and framing. |
| `config.originsRegex` | `ORIGINS_REGEX` | `[]` | Origin regexes (YAML list). |
| `config.themeOrigins` | `THEME_ORIGINS` | `[]` | Origins allowed to serve external theme CSS (YAML list). |
| `secrets.existingSecret` | (envFrom) |  | Name of a pre-existing Secret to load env from. |
| `secrets.githubAppId` | `GITHUB_APP_ID` |  | Inline only. |
| `secrets.githubClientId` | `GITHUB_CLIENT_ID` |  | Inline only. |
| `secrets.githubClientSecret` | `GITHUB_CLIENT_SECRET` |  | Inline only. |
| `secrets.githubPrivateKey` | `GITHUB_PRIVATE_KEY` |  | Inline only. PEM; `\n`-escaped accepted. |
| `secrets.encryptionPassword` | `ENCRYPTION_PASSWORD` |  | Inline only. At least 16 chars. |
| `secrets.githubWebhookSecret` | `GITHUB_WEBHOOK_SECRET` |  | Inline only. Optional; enables `/api/webhook` HMAC. |

Allowlists are given as native YAML lists and serialized to the JSON-array strings buncus
expects, so you never hand-write JSON:

```yaml
config:
  origins:
    - "https://docs.example.com"
    - "https://blog.example.com"
```

### Other values

| Value | Default | Notes |
|---|---|---|
| `image.repository` | `ghcr.io/liebstoeckel/buncus` | |
| `image.tag` | `""` | Falls back to the chart `appVersion` (the released image version). |
| `image.digest` | `""` | Pin by digest; takes precedence over `tag`. |
| `service.type` / `service.port` | `ClusterIP` / `4600` | |
| `ingress.enabled` | `false` | Optional templated Ingress; disabled by default. |
| `persistence.enabled` | `false` | Mount a PVC at the `BUNCUS_DB` directory so the token cache survives restarts. |
| `persistence.path` | `/data/buncus.sqlite` | DB path on the volume when persistence is enabled. |
| `persistence.size` | `1Gi` | |
| `livenessProbe` / `readinessProbe` | `GET /healthz` | HTTP probes against the container port. |
| `podSecurityContext` | nonroot uid/gid 65532 | Matches the distroless `:nonroot` runtime. |
| `securityContext` | `readOnlyRootFilesystem: true`, drop all caps | A writable `/tmp` emptyDir is mounted by default (`tmpDir.enabled`). |

## Persistence and the read-only root filesystem

buncus' on-disk DB is only the GitHub App installation-token cache, which is re-minted on a
miss. The default `BUNCUS_DB=:memory:` keeps it in RAM, so a read-only root filesystem works
out of the box (with a writable `/tmp` emptyDir for scratch).

Set `persistence.enabled: true` to keep the cache across restarts. The chart then points
`BUNCUS_DB` at `persistence.path`, mounts a PVC at that file's directory, and the pod's
`fsGroup` (65532) keeps it writable by the nonroot user.
