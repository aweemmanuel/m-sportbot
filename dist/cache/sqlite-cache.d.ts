/**
 * SQLite TTL cache — wraps better-sqlite3 for fast, concurrent-safe caching.
 * Uses WAL mode so the bot and Express API can share the same file.
 */
export declare const TTL: {
    SEARCH_FAST: number;
    FIXTURE: number;
    TEAM_LEAGUE: number;
    SUBSCRIBERS: number;
    MSPORT: number;
};
export declare class SqliteCache {
    private db;
    constructor(dbPath?: string);
    private createTable;
    /**
     * Get a cached value, or compute and store it if expired/missing.
     */
    getOrSet<T>(namespace: string, key: string, compute: () => Promise<T>, ttlMs: number): Promise<T>;
    /** Delete expired entries (call periodically). */
    purge(): number;
    /** Clear all entries in a namespace. */
    clearNamespace(namespace: string): number;
    close(): void;
}
//# sourceMappingURL=sqlite-cache.d.ts.map