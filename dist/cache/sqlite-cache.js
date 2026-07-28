"use strict";
/**
 * SQLite TTL cache — wraps better-sqlite3 for fast, concurrent-safe caching.
 * Uses WAL mode so the bot and Express API can share the same file.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteCache = exports.TTL = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// TTL presets (milliseconds)
exports.TTL = {
    SEARCH_FAST: 60_000, // 60 sec — fixture lists
    FIXTURE: 30_000, // 30 sec — single fixture
    TEAM_LEAGUE: 86_400_000, // 24 hr — team/league names
    SUBSCRIBERS: 0, // never expires
    MSPORT: 30_000, // 30 sec — Msport balance/session
};
class SqliteCache {
    db;
    constructor(dbPath = './.msport-cache.sqlite') {
        // Ensure directory exists
        const dir = path_1.default.dirname(dbPath);
        if (dir && !fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        this.db = new better_sqlite3_1.default(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('cache_size = -64000'); // 64MB
        this.createTable();
    }
    createTable() {
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
    async getOrSet(namespace, key, compute, ttlMs) {
        const now = Date.now();
        const row = this.db.prepare('SELECT value, expires_at FROM cache WHERE namespace = ? AND key = ?').get(namespace, key);
        if (row && row.expires_at > now) {
            return JSON.parse(row.value);
        }
        // Compute fresh value
        const value = await compute();
        const expiresAt = ttlMs === 0 ? now + 365_000_000_000 : now + ttlMs; // ~10 years for non-expiring
        this.db.prepare('INSERT OR REPLACE INTO cache (namespace, key, value, expires_at) VALUES (?, ?, ?, ?)').run(namespace, key, JSON.stringify(value), expiresAt);
        return value;
    }
    /** Delete expired entries (call periodically). */
    purge() {
        const now = Date.now();
        const result = this.db.prepare('DELETE FROM cache WHERE expires_at <= ?').run(now);
        return result.changes;
    }
    /** Clear all entries in a namespace. */
    clearNamespace(namespace) {
        const result = this.db.prepare('DELETE FROM cache WHERE namespace = ?').run(namespace);
        return result.changes;
    }
    close() {
        this.db.close();
    }
}
exports.SqliteCache = SqliteCache;
//# sourceMappingURL=sqlite-cache.js.map