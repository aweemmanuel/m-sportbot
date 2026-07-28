/**
 * Subscriber store — opt-in list for daily prediction push.
 * Stored in SQLite alongside the TTL cache (never expires).
 */

import BetterSqlite3 from 'better-sqlite3';

type Database = BetterSqlite3.Database;

export interface Subscriber {
  chatId: number;
  language?: string | null;
  addedAt: number;
}

export class SubscriberStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.createTable();
  }

  private createTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscribers (
        chat_id INTEGER PRIMARY KEY,
        language TEXT,
        added_at INTEGER NOT NULL
      );
    `);
  }

  add(chatId: number, language?: string | null): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO subscribers (chat_id, language, added_at) VALUES (?, ?, ?)'
    ).run(chatId, language ?? null, Date.now());
  }

  remove(chatId: number): boolean {
    const result = this.db.prepare('DELETE FROM subscribers WHERE chat_id = ?').run(chatId);
    return result.changes > 0;
  }

  list(): Subscriber[] {
    return this.db.prepare('SELECT chat_id, language, added_at FROM subscribers').all() as Subscriber[];
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM subscribers').get() as { cnt: number };
    return row.cnt;
  }

  has(chatId: number): boolean {
    const row = this.db.prepare('SELECT 1 FROM subscribers WHERE chat_id = ?').get(chatId);
    return row !== undefined;
  }
}
