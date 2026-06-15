# syntax=docker/dockerfile:1
#
# buncus — multi-stage build on a distroless runtime.
#
# The compiled binary embeds the Bun runtime + all assets (loader, widget, CSS,
# themes), but it is *not* statically linked: it needs glibc + the dynamic
# linker, and CA certificates for the outbound HTTPS to GitHub. distroless/cc
# provides exactly that (glibc, libgcc/libstdc++, CA bundle, NSS + nsswitch for
# DNS, a non-root user) while staying minimal — and unlike a hand-rolled
# `FROM scratch`, it carries the dpkg package metadata (so Trivy/Grype can scan
# it) and the per-package copyright files (so glibc's LGPL notices ship with it).
#
# cc-debian13 matches the builder's Debian 13 / glibc 2.41 — keep them in sync.
#
#   docker build -t buncus .
#   docker run --rm -p 4600:4600 -e BUNCUS_MOCK=1 buncus            # local smoke
#   docker run --rm -p 4600:4600 \
#     -e GITHUB_APP_ID=… -e GITHUB_CLIENT_ID=… -e GITHUB_CLIENT_SECRET=… \
#     -e GITHUB_PRIVATE_KEY="$(cat app.pem)" \
#     -e ENCRYPTION_PASSWORD="$(openssl rand -hex 32)" \
#     -e BUNCUS_PUBLIC_URL="https://comments.example.com" \
#     -e ORIGINS='["https://your.site"]' buncus                     # production

########################################
# Stage 1 — build the standalone binary
########################################
FROM oven/bun:1.3.14 AS builder
WORKDIR /app

# Install deps first (cached unless a manifest or the lockfile changes).
# --production skips root devDeps (playwright et al.) so no browser download.
COPY package.json bun.lock ./
COPY packages/buncus/package.json packages/buncus/package.json
COPY packages/mock-github/package.json packages/mock-github/package.json
RUN bun install --frozen-lockfile --production

# Build the embedded assets + compile the single binary.
COPY . .
RUN cd packages/buncus && bun run compile     # -> packages/buncus/dist/buncus

# Generate the third-party attribution report for everything embedded in the
# binary (bundled JS deps + the Bun runtime's bundled libs, incl. LGPL WebKit).
# Needs network to fetch Bun's LICENSE.md for the running version.
RUN cd packages/buncus && bun run scripts/third-party-licenses.ts dist/THIRD_PARTY_LICENSES.txt

########################################
# Stage 2 — distroless runtime
########################################
# :nonroot runs as uid 65532; glibc + CA certs + NSS are already present.
FROM gcr.io/distroless/cc-debian13:nonroot
COPY --from=builder /app/packages/buncus/dist/buncus /app/buncus
# Third-party license/attribution notice for the bundled software.
COPY --from=builder /app/packages/buncus/dist/THIRD_PARTY_LICENSES.txt /THIRD_PARTY_LICENSES.txt

ENV PORT=4600 \
    BUNCUS_DB=:memory:
EXPOSE 4600
# For a file-backed BUNCUS_DB, mount a volume writable by uid 65532.
ENTRYPOINT ["/app/buncus"]
