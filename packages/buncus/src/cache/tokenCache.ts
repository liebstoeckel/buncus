// GitHub App installation access-token cache, backed by bun:sqlite.
//
// Security (security-report.md M2): the token column is encrypted at rest with
// the same AES-GCM box used for sessions, and the DB file (plus WAL/SHM
// sidecars) is chmod 0600. Replaces giscus' Supabase/PostgREST/Valkey choice.
//
// Preserves giscus semantics: 5-minute "intolerance" window (a near-expiry token
// reads back blank to force a re-mint) and created_at-on-first-write.

import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { decrypt, encrypt } from "../crypto/encryption.ts";

const INTOLERANCE_MS = 5 * 60 * 1000;

export interface InstallationToken {
  installation_id: number;
  token: string;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
}

interface Row {
  installation_id: number;
  token: string; // encrypted at rest
  expires_at: string;
  created_at: string | null;
  updated_at: string | null;
}

export class TokenCache {
  private db: Database;
  private password: string;
  private path: string;

  constructor(path = ":memory:", password = "") {
    this.path = path;
    this.password = password;
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS installation_access_tokens (
        installation_id INTEGER PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
    `);
    this.restrictPerms();
  }

  private restrictPerms(): void {
    if (this.path === ":memory:") return;
    for (const f of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      try {
        chmodSync(f, 0o600);
      } catch {
        // sidecars may not exist yet; best-effort.
      }
    }
  }

  async get(installationId: number): Promise<InstallationToken | null> {
    const row = this.db
      .query<Row, [number]>(
        "SELECT installation_id, token, expires_at, created_at, updated_at FROM installation_access_tokens WHERE installation_id = ?",
      )
      .get(installationId);
    if (!row) return null;
    const base: InstallationToken = {
      installation_id: row.installation_id,
      token: "",
      expires_at: row.expires_at,
      created_at: row.created_at ?? undefined,
      updated_at: row.updated_at ?? undefined,
    };
    // Within the intolerance window → keep created_at but blank the token.
    if (new Date(row.expires_at).getTime() - Date.now() < INTOLERANCE_MS) return base;
    base.token = this.password ? await decrypt(row.token, this.password) : row.token;
    return base;
  }

  async set(t: InstallationToken): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.db
      .query<{ created_at: string | null }, [number]>(
        "SELECT created_at FROM installation_access_tokens WHERE installation_id = ?",
      )
      .get(t.installation_id);
    const created_at = existing?.created_at ?? t.created_at ?? now;
    const stored = this.password ? await encrypt(t.token, this.password) : t.token;
    this.db
      .query(
        `INSERT INTO installation_access_tokens (installation_id, token, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(installation_id) DO UPDATE SET
           token = excluded.token, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      )
      .run(t.installation_id, stored, t.expires_at, created_at, now);
    this.restrictPerms();
  }

  close(): void {
    this.db.close();
  }
}
