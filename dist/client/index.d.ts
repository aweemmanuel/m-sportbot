/**
 * Score180Client — Headless API client for the 180Score prediction service.
 * Extracted from the decompiled Android app (com.4grow.score).
 * Uses the public MeiliSearch endpoint for fixture predictions.
 */
export interface Score180Config {
    apiUrl?: string;
    searchUrl?: string;
    searchKey?: string;
    jwt?: string;
    timeout?: number;
}
export declare class Score180Client {
    private api;
    private searchUrl;
    private searchKey;
    private jwt;
    constructor(config?: Score180Config);
    setJwt(jwt: string): void;
    searchIndex(index: string, params: MeiliSearchParams): Promise<MeiliSearchHit>;
    searchFixtures(q: string, limit?: number): Promise<any[]>;
    searchTeams(q: string, limit?: number): Promise<any[]>;
    searchLeagues(q: string, limit?: number): Promise<any[]>;
    getFixture(id: number): Promise<any>;
    listFixturesForTeam(teamId: number, opts?: {
        dateFrom?: string;
        dateTo?: string;
    }): Promise<any[]>;
    getStandings(leagueId: number, season: number): Promise<any[]>;
}
export interface MeiliSearchParams {
    q?: string;
    filter?: string;
    sort?: string | string[];
    limit?: number;
    offset?: number;
    attributesToRetrieve?: string[];
}
export interface MeiliSearchHit {
    hits: any[];
    estimatedTotalHits?: number;
    processingTimeMs?: number;
    query: string;
}
//# sourceMappingURL=index.d.ts.map