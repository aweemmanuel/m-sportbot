/**
 * Predictions service — cached bridge between Score180Client and our system.
 * Fetches from MeiliSearch, extracts predictions, applies confidence filters.
 */

import { Score180Client } from '../client';
import { SqliteCache, TTL } from '../cache/sqlite-cache';
import { Prediction, extractPredictions } from './extractor';

export interface ListOptions {
  date?: string;
  limit?: number;
  leagueId?: number;
  teamId?: number;
  minConfidence?: number;
  sort?: 'confidence' | 'time';
}

export class PredictionsService {
  constructor(
    private client: Score180Client,
    private cache: SqliteCache,
  ) {}

  async list(opts: ListOptions = {}): Promise<Prediction[]> {
    const date = opts.date ?? todayUtc();
    const limit = clamp(opts.limit ?? 10, 1, 50);
    const minConfidence = opts.minConfidence ?? 0;

    const filters: string[] = [`date = ${date}`];
    if (opts.leagueId) filters.push(`league.id = ${opts.leagueId}`);
    const filter = filters.join(' AND ');

    const cacheKey = `d=${date}|l=${limit}|f=${filter}|c=${minConfidence}|s=${opts.sort ?? 'confidence'}`;

    const hits = await this.cache.getOrSet(
      'search',
      cacheKey,
      async () => {
        const resp = await this.client.searchIndex('fb-fixtures', {
          q: '',
          filter,
          limit: 500,
          sort: opts.sort === 'time' ? ['timestamp:asc'] : ['bpa_predict_ai:desc'],
        });
        return resp.hits ?? [];
      },
      TTL.SEARCH_FAST,
    );

    let preds = extractPredictions(hits);
    if (opts.teamId) {
      preds = preds.filter(p => p.home.id === opts.teamId || p.away.id === opts.teamId);
    }
    if (minConfidence > 0) {
      preds = preds.filter(p => p.bestPick.probability >= minConfidence);
    }
    return preds.slice(0, limit);
  }

  async get(fixtureId: number): Promise<Prediction | null> {
    const cacheKey = `f=${fixtureId}`;
    const hits = await this.cache.getOrSet(
      'fixture',
      cacheKey,
      async () => {
        const resp = await this.client.searchIndex('fb-fixtures', {
          q: String(fixtureId),
          limit: 3,
        });
        const all = resp.hits ?? [];
        const exact = all.filter((h: any) => Number(h.id) === fixtureId);
        return exact.length ? exact : all.slice(0, 1);
      },
      TTL.FIXTURE,
    );
    if (!hits.length) return null;
    try {
      return extractPredictions(hits)[0] ?? null;
    } catch {
      return null;
    }
  }

  async today(): Promise<Prediction[]> {
    return this.list({ date: todayUtc(), limit: 10, sort: 'confidence' });
  }

  async searchTeams(q: string, limit = 8): Promise<Array<{ id: number; name: string; logo?: string | null }>> {
    if (!q.trim()) return [];
    const cacheKey = `q=${q.toLowerCase()}|l=${limit}`;
    const teams = await this.cache.getOrSet('teams', cacheKey, async () => {
      const hits = await this.client.searchTeams(q, limit);
      return hits.map((t: any) => ({ id: t.id, name: t.name, logo: t.logo ?? null }));
    }, TTL.TEAM_LEAGUE);
    return teams;
  }

  async searchLeagues(q: string, limit = 8): Promise<Array<{ id: number; name: string; logo?: string | null; country?: string | null }>> {
    if (!q.trim()) return [];
    const cacheKey = `q=${q.toLowerCase()}|l=${limit}`;
    const leagues = await this.cache.getOrSet('leagues', cacheKey, async () => {
      const hits = await this.client.searchLeagues(q, limit);
      return hits.map((l: any) => ({ id: l.id, name: l.name, logo: l.logo ?? null, country: l.country_code ?? l.country ?? null }));
    }, TTL.TEAM_LEAGUE);
    return leagues;
  }
}

function todayUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
