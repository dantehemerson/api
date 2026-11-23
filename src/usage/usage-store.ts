import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ChatGPTSnapshot, MachineSnapshotData } from './validators'

/** Machines snapshots expire after 30 days, mirroring the previous KV expirationTtl. */
export const MACHINES_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type UsageKind = 'chatgpt' | 'machines'

export interface StoredSnapshot {
  kind: UsageKind
  /** Canonical JSON text of the snapshot, stored as-is for byte-identical round-trips. */
  payload: string
  fetchedAt: string
  updatedAt: string
}

/**
 * SQLite-backed snapshot storage (node:sqlite, no native modules). The ChatGPT
 * snapshot is kept indefinitely; machines snapshots are purged 30 days after
 * their last write, exactly like the KV expiration they replace.
 */
export class UsageStore {
  private readonly db: DatabaseSync
  private readonly upsert: ReturnType<DatabaseSync['prepare']>
  private readonly select: ReturnType<DatabaseSync['prepare']>
  private readonly purgeExpired: ReturnType<DatabaseSync['prepare']>

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS usage_snapshots (
        kind       TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    this.upsert = this.db.prepare(`
      INSERT INTO usage_snapshots (kind, payload, fetched_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (kind) DO UPDATE SET
        payload = excluded.payload,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at
    `)
    this.select = this.db.prepare('SELECT payload, fetched_at, updated_at FROM usage_snapshots WHERE kind = ?')
    this.purgeExpired = this.db.prepare("DELETE FROM usage_snapshots WHERE kind = 'machines' AND updated_at < ?")
  }

  save(kind: UsageKind, snapshot: ChatGPTSnapshot | MachineSnapshotData): void {
    if (kind === 'machines') {
      this.purgeExpiredMachines()
    }
    this.upsert.run(kind, JSON.stringify(snapshot), snapshot.fetchedAt, new Date().toISOString())
  }

  read(kind: UsageKind): StoredSnapshot | null {
    if (kind === 'machines') {
      this.purgeExpiredMachines()
    }
    const row = this.select.get(kind)
    if (!row) {
      return null
    }
    return {
      kind,
      payload: String(row.payload),
      fetchedAt: String(row.fetched_at),
      updatedAt: String(row.updated_at),
    }
  }

  close(): void {
    this.db.close()
  }

  private purgeExpiredMachines(now: number = Date.now()): void {
    this.purgeExpired.run(new Date(now - MACHINES_RETENTION_MS).toISOString())
  }
}
