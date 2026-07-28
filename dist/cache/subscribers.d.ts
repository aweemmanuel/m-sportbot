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
export declare class SubscriberStore {
    private db;
    constructor(db: Database);
    private createTable;
    add(chatId: number, language?: string | null): void;
    remove(chatId: number): boolean;
    list(): Subscriber[];
    count(): number;
    has(chatId: number): boolean;
}
export {};
//# sourceMappingURL=subscribers.d.ts.map