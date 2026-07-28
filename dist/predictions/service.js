"use strict";
/**
 * Predictions service — cached bridge between Score180Client and our system.
 * Fetches from MeiliSearch, extracts predictions, applies confidence filters.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PredictionsService = void 0;
const sqlite_cache_1 = require("../cache/sqlite-cache");
const extractor_1 = require("./extractor");
class PredictionsService {
    client;
    cache;
    constructor(client, cache) {
        this.client = client;
        this.cache = cache;
    }
    async list(opts = {}) {
        const date = opts.date ?? todayUtc();
        const limit = clamp(opts.limit ?? 10, 1, 50);
        const minConfidence = opts.minConfidence ?? 0;
        const filters = [`date = ${date}`];
        if (opts.leagueId)
            filters.push(`league.id = ${opts.leagueId}`);
        const filter = filters.join(' AND ');
        const cacheKey = `d=${date}|l=${limit}|f=${filter}|c=${minConfidence}|s=${opts.sort ?? 'confidence'}`;
        const hits = await this.cache.getOrSet('search', cacheKey, async () => {
            const resp = await this.client.searchIndex('fb-fixtures', {
                q: '',
                filter,
                limit: 500,
                sort: opts.sort === 'time' ? ['timestamp:asc'] : ['bpa_predict_ai:desc'],
            });
            return resp.hits ?? [];
        }, sqlite_cache_1.TTL.SEARCH_FAST);
        let preds = (0, extractor_1.extractPredictions)(hits);
        if (opts.teamId) {
            preds = preds.filter(p => p.home.id === opts.teamId || p.away.id === opts.teamId);
        }
        if (minConfidence > 0) {
            preds = preds.filter(p => p.bestPick.probability >= minConfidence);
        }
        return preds.slice(0, limit);
    }
    async get(fixtureId) {
        const cacheKey = `f=${fixtureId}`;
        const hits = await this.cache.getOrSet('fixture', cacheKey, async () => {
            const resp = await this.client.searchIndex('fb-fixtures', {
                q: String(fixtureId),
                limit: 3,
            });
            const all = resp.hits ?? [];
            const exact = all.filter((h) => Number(h.id) === fixtureId);
            return exact.length ? exact : all.slice(0, 1);
        }, sqlite_cache_1.TTL.FIXTURE);
        if (!hits.length)
            return null;
        try {
            return (0, extractor_1.extractPredictions)(hits)[0] ?? null;
        }
        catch {
            return null;
        }
    }
    async today() {
        return this.list({ date: todayUtc(), limit: 10, sort: 'confidence' });
    }
    async searchTeams(q, limit = 8) {
        if (!q.trim())
            return [];
        const cacheKey = `q=${q.toLowerCase()}|l=${limit}`;
        const teams = await this.cache.getOrSet('teams', cacheKey, async () => {
            const hits = await this.client.searchTeams(q, limit);
            return hits.map((t) => ({ id: t.id, name: t.name, logo: t.logo ?? null }));
        }, sqlite_cache_1.TTL.TEAM_LEAGUE);
        return teams;
    }
    async searchLeagues(q, limit = 8) {
        if (!q.trim())
            return [];
        const cacheKey = `q=${q.toLowerCase()}|l=${limit}`;
        const leagues = await this.cache.getOrSet('leagues', cacheKey, async () => {
            const hits = await this.client.searchLeagues(q, limit);
            return hits.map((l) => ({ id: l.id, name: l.name, logo: l.logo ?? null, country: l.country_code ?? l.country ?? null }));
        }, sqlite_cache_1.TTL.TEAM_LEAGUE);
        return leagues;
    }
}
exports.PredictionsService = PredictionsService;
function todayUtc() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}
//# sourceMappingURL=service.js.map