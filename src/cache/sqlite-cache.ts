/**
 * SQLite TTL cache — wraps better-sqlite3 for fast, concurrent-safe caching.
 * Uses WAL mode so the bot and Express API can share the same file.
 */

import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// TTL presets (milliseconds)
export const TTL = {
  SEARCH_FAST: 60_000,   // 60 sec — fixture lists
  FIXTURE: 30_000,       // 30 sec — single fixture
  TEAM_LEAGUE: 86_400_000, // 24 hr — team/league names
  SUBSCRIBERS: 0,         // never expires
  MSPORT: 30_000,         // 30 sec — Msport balance/session
};

type Database = BetterSqlite3.Database;

export class SqliteCache {
  private db: Database;

  constructor(dbPath: string = './.msport-cache.sqlite') {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB

    this.createTable();
  }

  private createTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      );
      CREATE INDEX IF NOT EXISTS idx_expires ON cache (expires_at);
    `);
  }

  /**
   * Get a cached value, or compute and store it if expired/missing.
   */
  async getOrSet<T>(
    namespace: string,
    key: string,
    compute: () => Promise<T>,
    ttlMs: number,
  ): Promise<T> {
    const now = Date.now();
    const row = this.db.prepare(
      'SELECT value, expires_at FROM cache WHERE namespace = ? AND key = ?'
    ).get(namespace, key) as { value: string; expires_at: number } | undefined;

    if (row && row.expires_at > now) {
      return JSON.parse(row.value);
    }

    // Compute fresh value
    const value = await compute();
    const expiresAt = ttlMs === 0 ? now + 365_000_000_000 : now + ttlMs; // ~10 years for non-expiring

    this.db.prepare(
      'INSERT OR REPLACE INTO cache (namespace, key, value, expires_at) VALUES (?, ?, ?, ?)'
    ).run(namespace, key, JSON.stringify(value), expiresAt);

    return value;
  }

  /** Delete expired entries (call periodically). */
  purge(): number {
    const now = Date.now();
    const result = this.db.prepare('DELETE FROM cache WHERE expires_at <= ?').run(now);
    return result.changes;
  }

  /** Clear all entries in a namespace. */
  clearNamespace(namespace: string): number {
    const result = this.db.prepare('DELETE FROM cache WHERE namespace = ?').run(namespace);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
