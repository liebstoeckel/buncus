// Runtime configuration, read from the environment.
//
// Security posture (see security-report.md):
//  - H1: required secrets must be set in production; the known dev password and
//    short passwords are refused. Mock defaults are gated behind BUNCUS_MOCK=1.
//  - Unlike giscus, both GitHub hosts are configurable (so the stack can run
//    against @buncus/mock-github with no GitHub access).

import { generateKeyPairSync } from "node:crypto";

const DEV_PASSWORD = "dev-only-insecure-password-change-me-please";

const MOCK_DEFAULTS: Record<string, string> = {
  ENCRYPTION_PASSWORD: DEV_PASSWORD,
  GITHUB_CLIENT_ID: "Iv1.mockclient0000",
  GITHUB_CLIENT_SECRET: "mock_client_secret_value",
  GITHUB_APP_ID: "123456",
};

export interface Config {
  port: number;
  publicUrl: string; // buncus' own public base URL (OAuth callback + same-origin check)
  apiHost: string; // GitHub REST/GraphQL base
  oauthHost: string; // GitHub OAuth base
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string; // PEM (RS256). `\n`-escaped values are normalised.
  encryptionPassword: string;
  dbPath: string;
  /** Allowlist of embedding origins (OAuth redirect + framing + API). Empty = same-origin only. */
  origins: string[];
  originsRegex: string[];
  /** Extra origins permitted to serve custom theme CSS (style-src). */
  themeOrigins: string[];
  /** Session token lifetime in ms. */
  sessionTtlMs: number;
  /** Optional GitHub webhook secret; when set, /api/webhook verifies the HMAC. */
  webhookSecret: string;
  /** True when running with mock defaults (relaxed validation). */
  mock: boolean;
}

let cached: Config | null = null;

function parseEnv(): Config {
  const mock = process.env.BUNCUS_MOCK === "1";
  const port = Number(process.env.PORT ?? 4600);
  const publicUrl = (process.env.BUNCUS_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, "");

  const required = (name: string): string => {
    const v = process.env[name];
    if (v?.length) return v;
    if (mock && MOCK_DEFAULTS[name]) return MOCK_DEFAULTS[name];
    throw new Error(`Config error: ${name} is required. Set it, or run with BUNCUS_MOCK=1 for local/testing.`);
  };

  const encryptionPassword = required("ENCRYPTION_PASSWORD");
  if (!mock) {
    if (encryptionPassword === DEV_PASSWORD) {
      throw new Error(
        "Config error: ENCRYPTION_PASSWORD is set to the known insecure dev default. Generate a unique value (e.g. `openssl rand -hex 32`).",
      );
    }
    if (encryptionPassword.length < 16) {
      throw new Error("Config error: ENCRYPTION_PASSWORD must be at least 16 characters.");
    }
  }

  let privateKey = (process.env.GITHUB_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  if (!privateKey) {
    if (mock) {
      // Ephemeral key so the app-token path works in local/mock runs (the mock
      // doesn't verify the signature anyway).
      privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ type: "pkcs1", format: "pem" })
        .toString();
    } else {
      throw new Error("Config error: GITHUB_PRIVATE_KEY is required.");
    }
  }

  return {
    port,
    publicUrl,
    apiHost: (process.env.GITHUB_API_HOST ?? "https://api.github.com").replace(/\/$/, ""),
    oauthHost: (process.env.GITHUB_OAUTH_HOST ?? "https://github.com").replace(/\/$/, ""),
    appId: required("GITHUB_APP_ID"),
    clientId: required("GITHUB_CLIENT_ID"),
    clientSecret: required("GITHUB_CLIENT_SECRET"),
    privateKey,
    encryptionPassword,
    dbPath: process.env.BUNCUS_DB ?? ":memory:",
    origins: JSON.parse(process.env.ORIGINS ?? "[]"),
    originsRegex: JSON.parse(process.env.ORIGINS_REGEX ?? "[]"),
    themeOrigins: JSON.parse(process.env.THEME_ORIGINS ?? "[]"),
    sessionTtlMs: Number(process.env.SESSION_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    mock,
  };
}

function defaultBase(): Config {
  // Non-validating base used by setConfig() in tests; never reads required env.
  const port = Number(process.env.PORT ?? 4600);
  return {
    port,
    publicUrl: `http://localhost:${port}`,
    apiHost: "https://api.github.com",
    oauthHost: "https://github.com",
    appId: "",
    clientId: "",
    clientSecret: "",
    privateKey: "",
    encryptionPassword: "test-insecure-password-placeholder",
    dbPath: ":memory:",
    origins: [],
    originsRegex: [],
    themeOrigins: [],
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    webhookSecret: "",
    mock: true,
  };
}

export function getConfig(): Config {
  if (!cached) cached = parseEnv();
  return cached;
}

/** For tests: override config without triggering env validation. Merges onto the
 *  existing cached config (so repeated calls accumulate), or a safe base. */
export function setConfig(overrides: Partial<Config>): Config {
  cached = { ...(cached ?? defaultBase()), ...overrides };
  return cached;
}

export function resetConfig(): void {
  cached = null;
}

/** Origin of buncus itself (same-origin requests are always trusted). */
export function selfOrigin(cfg: Config): string {
  try {
    return new URL(cfg.publicUrl).origin;
  } catch {
    return "";
  }
}

/** Is `origin` (an origin string like "https://site.example") allowed to embed / redirect / call the API? */
export function isAllowedOrigin(origin: string, cfg: Config): boolean {
  if (!origin) return false;
  if (origin === selfOrigin(cfg)) return true;
  if (cfg.origins.includes(origin)) return true;
  return cfg.originsRegex.some((re) => {
    try {
      return new RegExp(re).test(origin);
    } catch {
      return false;
    }
  });
}

/** Validate a full redirect/return URL: parseable and its origin is allowlisted. */
export function isAllowedRedirect(rawUrl: string, cfg: Config): boolean {
  try {
    return isAllowedOrigin(new URL(rawUrl).origin, cfg);
  } catch {
    return false;
  }
}
