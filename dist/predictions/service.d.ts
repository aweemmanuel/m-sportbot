/**
 * Predictions service — cached bridge between Score180Client and our system.
 * Fetches from MeiliSearch, extracts predictions, applies confidence filters.
 */
import { Score180Client } from '../client';
import { SqliteCache } from '../cache/sqlite-cache';
import { Prediction } from './extractor';
export interface ListOptions {
    date?: string;
    limit?: number;
    leagueId?: number;
    teamId?: number;
    minConfidence?: number;
    sort?: 'confidence' | 'time';
}
export declare class PredictionsService {
    private client;
    private cache;
    constructor(client: Score180Client, cache: SqliteCache);
    list(opts?: ListOptions): Promise<Prediction[]>;
    get(fixtureId: number): Promise<Prediction | null>;
    today(): Promise<Prediction[]>;
    searchTeams(q: string, limit?: number): Promise<Array<{
        id: number;
        name: string;
        logo?: string | null;
    }>>;
    searchLeagues(q: string, limit?: number): Promise<Array<{
        id: number;
        name: string;
        logo?: string | null;
        country?: string | null;
    }>>;
}
//# sourceMappingURL=service.d.ts.map