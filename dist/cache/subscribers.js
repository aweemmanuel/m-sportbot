"use strict";
/**
 * Subscriber store — opt-in list for daily prediction push.
 * Stored in SQLite alongside the TTL cache (never expires).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriberStore = void 0;
class SubscriberStore {
    db;
    constructor(db) {
        this.db = db;
        this.createTable();
    }
    createTable() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscribers (
        chat_id INTEGER PRIMARY KEY,
        language TEXT,
        added_at INTEGER NOT NULL
      );
    `);
    }
    add(chatId, language) {
        this.db.prepare('INSERT OR REPLACE INTO subscribers (chat_id, language, added_at) VALUES (?, ?, ?)').run(chatId, language ?? null, Date.now());
    }
    remove(chatId) {
        const result = this.db.prepare('DELETE FROM subscribers WHERE chat_id = ?').run(chatId);
        return result.changes > 0;
    }
    list() {
        return this.db.prepare('SELECT chat_id, language, added_at FROM subscribers').all();
    }
    count() {
        const row = this.db.prepare('SELECT COUNT(*) as cnt FROM subscribers').get();
        return row.cnt;
    }
    has(chatId) {
        const row = this.db.prepare('SELECT 1 FROM subscribers WHERE chat_id = ?').get(chatId);
        return row !== undefined;
    }
}
exports.SubscriberStore = SubscriberStore;
//# sourceMappingURL=subscribers.js.map