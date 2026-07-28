"use strict";
/**
 * Score180Client — Headless API client for the 180Score prediction service.
 * Extracted from the decompiled Android app (com.4grow.score).
 * Uses the public MeiliSearch endpoint for fixture predictions.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Score180Client = void 0;
const axios_1 = __importDefault(require("axios"));
const DEFAULT_API_URL = 'https://api.180score.ai/api/';
const DEFAULT_SEARCH_URL = 'https://search.180score.ai';
const DEFAULT_SEARCH_KEY = '4835ec5f70b7d2c8ae9e9fc30ba9d25ef46b';
const DEFAULT_TIMEOUT = 20_000;
// ----------------------------------------------------------------------------
// Client
// ----------------------------------------------------------------------------
class Score180Client {
    api;
    searchUrl;
    searchKey;
    jwt;
    constructor(config = {}) {
        const apiUrl = config.apiUrl ?? DEFAULT_API_URL;
        const searchUrl = config.searchUrl ?? DEFAULT_SEARCH_URL;
        const searchKey = config.searchKey ?? DEFAULT_SEARCH_KEY;
        const timeout = config.timeout ?? DEFAULT_TIMEOUT;
        this.searchUrl = searchUrl;
        this.searchKey = searchKey;
        this.jwt = config.jwt ?? null;
        this.api = axios_1.default.create({
            baseURL: apiUrl,
            timeout,
            headers: { 'Content-Type': 'application/json' },
        });
        // JWT auth interceptor
        this.api.interceptors.request.use((req) => {
            if (this.jwt) {
                req.headers.set('Authorization', `Bearer ${this.jwt}`);
            }
            return req;
        });
        // Strapi v4 flattener on response
        this.api.interceptors.response.use((res) => {
            if (res.data && res.data.data) {
                res.data = flattenStrapiV4(res.data);
            }
            return res;
        });
    }
    setJwt(jwt) {
        this.jwt = jwt;
    }
    // ---- MeiliSearch (predictions) ----
    async searchIndex(index, params) {
        const url = `${this.searchUrl}/indexes/${index}/search`;
        const resp = await axios_1.default.post(url, params, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.searchKey}`,
            },
            timeout: this.api.defaults.timeout ?? DEFAULT_TIMEOUT,
        });
        return resp.data;
    }
    async searchFixtures(q, limit = 20) {
        const resp = await this.searchIndex('fb-fixtures', {
            q,
            limit,
            sort: ['bpa_predict_ai:desc'],
        });
        return resp.hits ?? [];
    }
    async searchTeams(q, limit = 8) {
        const resp = await this.searchIndex('football-team', { q, limit });
        return resp.hits ?? [];
    }
    async searchLeagues(q, limit = 8) {
        const resp = await this.searchIndex('football-league', { q, limit });
        return resp.hits ?? [];
    }
    // ---- Strapi REST ----
    async getFixture(id) {
        const resp = await this.api.get(`/fixtures/${id}`);
        return resp.data;
    }
    async listFixturesForTeam(teamId, opts = {}) {
        const params = {};
        if (opts.dateFrom)
            params['dateFrom'] = opts.dateFrom;
        if (opts.dateTo)
            params['dateTo'] = opts.dateTo;
        const resp = await this.api.get(`/fixtures/team/${teamId}`, { params });
        return resp.data ?? [];
    }
    async getStandings(leagueId, season) {
        const resp = await this.api.get(`/standings/${leagueId}`, { params: { season } });
        return resp.data ?? [];
    }
}
exports.Score180Client = Score180Client;
function flattenStrapiV4(data) {
    if (!data)
        return data;
    // Single entry: { data: { id, attributes: { ... } } }
    if (data.data && !Array.isArray(data.data) && data.data.attributes) {
        const flat = { id: data.data.id, ...data.data.attributes };
        return { data: deepFlatten(flat), meta: data.meta };
    }
    // Collection: { data: [ { id, attributes: { ... } } ] }
    if (data.data && Array.isArray(data.data)) {
        const flat = data.data.map((item) => {
            if (item.attributes) {
                return { id: item.id, ...item.attributes };
            }
            return item;
        });
        return { data: flat.map(deepFlatten), meta: data.meta };
    }
    return data;
}
function deepFlatten(obj) {
    if (!obj || typeof obj !== 'object')
        return obj;
    if (Array.isArray(obj))
        return obj.map(deepFlatten);
    const result = {};
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        // Strapi relation: { data: { id, attributes } } or { data: [ ... ] }
        if (val && typeof val === 'object' && val.data) {
            if (Array.isArray(val.data)) {
                result[key] = val.data.map((d) => d.attributes ? { id: d.id, ...d.attributes } : d);
            }
            else if (val.data && val.data.attributes) {
                result[key] = { id: val.data.id, ...val.data.attributes };
            }
            else if (val.data === null) {
                result[key] = null;
            }
            else {
                result[key] = val.data;
            }
        }
        else {
            result[key] = deepFlatten(val);
        }
    }
    return result;
}
//# sourceMappingURL=index.js.map