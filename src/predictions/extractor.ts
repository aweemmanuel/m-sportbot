/**
 * Predictions extractor — turns raw MeiliSearch hits into typed Prediction objects.
 * Handles: 1X2, DoubleChance, BTS, OverUnder markets.
 * Maps bpa_key codes to human-readable labels.
 */

export interface TeamRef { id: number; name: string; logo?: string | null; }
export interface LeagueRef { id: number; name: string; logo?: string | null; country?: string | null; }
export interface ScoreRef { home: number | null; away: number | null; htHome: number | null; htAway: number | null; }
export interface OddsRef { home: number | null; draw: number | null; away: number | null; }

export interface MarketPick {
  market: string;
  label: string;
  probability: number;
  odds: number | null;
  pick: string;
}

export interface Prediction1x2 {
  home: number; draw: number; away: number;
  pick: 'home' | 'draw' | 'away';
  confidence: number;
}

export interface PredictionDoubleChance {
  homeDraw: number; homeAway: number; drawAway: number;
  pick: 'homeDraw' | 'homeAway' | 'drawAway';
  confidence: number;
}

export interface PredictionBts {
  yes: number; no: number;
  pick: 'yes' | 'no';
  confidence: number;
}

export interface PredictionOverUnder {
  line: number;
  over: number;
  under: number;
  pick: 'over' | 'under';
  confidence: number;
}

export interface PredictionSet {
  oneXTwo: Prediction1x2;
  doubleChance: PredictionDoubleChance;
  bts: PredictionBts;
  overUnder: PredictionOverUnder[];
}

export interface Prediction {
  fixtureId: number;
  date: string;
  time: string | null;
  status: string;
  timestamp: number | null;
  round?: string | null;
  venue?: string | null;
  league: LeagueRef;
  home: TeamRef;
  away: TeamRef;
  score: ScoreRef;
  odds: OddsRef;
  predictions: PredictionSet;
  bestPick: MarketPick;
}

// ---- bpa_key -> human label ----

const BPA_LABELS: Record<string, { market: string; label: string; pick: string }> = {
  home:            { market: '1x2',         label: 'Home Win',         pick: 'home' },
  draw:            { market: '1x2',         label: 'Draw',              pick: 'draw' },
  away:            { market: '1x2',         label: 'Away Win',          pick: 'away' },
  dc_home_draw:    { market: 'doubleChance', label: '1X (Home or Draw)', pick: 'homeDraw' },
  dc_home_away:    { market: 'doubleChance', label: '12 (Home or Away)', pick: 'homeAway' },
  dc_draw_away:    { market: 'doubleChance', label: 'X2 (Draw or Away)', pick: 'drawAway' },
  bts_yes:         { market: 'bts', label: 'Both Teams To Score — Yes', pick: 'yes' },
  bts_no:          { market: 'bts', label: 'Both Teams To Score — No',  pick: 'no' },
  gou_over_05:     { market: 'overUnder', label: 'Over 0.5 Goals',  pick: 'over' },
  gou_under_05:    { market: 'overUnder', label: 'Under 0.5 Goals', pick: 'under' },
  gou_over_15:     { market: 'overUnder', label: 'Over 1.5 Goals',  pick: 'over' },
  gou_under_15:    { market: 'overUnder', label: 'Under 1.5 Goals', pick: 'under' },
  gou_over_25:     { market: 'overUnder', label: 'Over 2.5 Goals',  pick: 'over' },
  gou_under_25:    { market: 'overUnder', label: 'Under 2.5 Goals', pick: 'under' },
  gou_over_35:     { market: 'overUnder', label: 'Over 3.5 Goals',  pick: 'over' },
  gou_under_35:    { market: 'overUnder', label: 'Under 3.5 Goals', pick: 'under' },
  gou_over_45:     { market: 'overUnder', label: 'Over 4.5 Goals',  pick: 'over' },
  gou_under_45:    { market: 'overUnder', label: 'Under 4.5 Goals', pick: 'under' },
  gou_over_55:     { market: 'overUnder', label: 'Over 5.5 Goals',  pick: 'over' },
  gou_under_55:    { market: 'overUnder', label: 'Under 5.5 Goals', pick: 'under' },
  gou_over_65:     { market: 'overUnder', label: 'Over 6.5 Goals',  pick: 'over' },
  gou_under_65:    { market: 'overUnder', label: 'Under 6.5 Goals', pick: 'under' },
};

// ---- Helpers ----

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickMax<T extends Record<string, number>>(obj: T): { pick: keyof T; confidence: number } {
  let bestKey: keyof T | null = null;
  let bestVal = -Infinity;
  for (const k of Object.keys(obj) as Array<keyof T>) {
    if (obj[k] > bestVal) {
      bestVal = obj[k];
      bestKey = k;
    }
  }
  return { pick: bestKey!, confidence: bestVal };
}

// ---- Main extractor ----

export function extractPrediction(hit: Record<string, any>): Prediction {
  if (!hit || typeof hit !== 'object') throw new Error('extractPrediction: hit is not an object');
  if (hit.id === undefined) throw new Error('extractPrediction: hit has no id');

  const leagueRaw = hit.league ?? {};
  const homeRaw = hit.team_home ?? {};
  const awayRaw = hit.team_away ?? {};

  // 1x2
  const pHome = num(hit.predict_ai);
  const pDraw = num(hit.predict_ai_draw);
  const pAway = num(hit.predict_ai_revert);
  const oneXTwoPick = pickMax({ home: pHome, draw: pDraw, away: pAway });

  // Double chance
  const pHD = num(hit.predict_ai_dc_home_draw);
  const pHA = num(hit.predict_ai_dc_home_away);
  const pDA = num(hit.predict_ai_dc_draw_away);
  const dcPick = pickMax({ homeDraw: pHD, homeAway: pHA, drawAway: pDA });

  // BTS
  const pBtsYes = num(hit.predict_ai_bts_yes);
  const pBtsNo = num(hit.predict_ai_bts_no);
  const btsPick = pickMax({ yes: pBtsYes, no: pBtsNo });

  // Over/Under lines 0.5 -> 6.5
  const lines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
  const overUnder: PredictionOverUnder[] = lines.map((line) => {
    const lineKey = String(Math.round(line * 10)).padStart(2, '0');
    const over = num(hit[`predict_ai_gou_over_${lineKey}`]);
    const under = num(hit[`predict_ai_gou_under_${lineKey}`]);
    const pick = over >= under ? 'over' : 'under';
    return { line, over, under, pick, confidence: Math.max(over, under) };
  });

  // Best pick
  const bpaKey = String(hit.bpa_key ?? '');
  const bpaLabel = BPA_LABELS[bpaKey] ?? { market: 'unknown', label: bpaKey || 'Unknown', pick: 'unknown' };

  const bestPick: MarketPick = {
    market: bpaLabel.market,
    label: bpaLabel.label,
    probability: num(hit.bpa_predict_ai),
    odds: nullableNum(hit.bpa_odds),
    pick: bpaLabel.pick,
  };

  return {
    fixtureId: Number(hit.id),
    date: String(hit.date ?? ''),
    time: hit.time ? String(hit.time) : null,
    status: String(hit.status ?? 'NS'),
    timestamp: nullableNum(hit.timestamp),
    round: hit.round ? String(hit.round) : null,
    venue: hit.venue ? String(hit.venue) : null,
    league: {
      id: Number(leagueRaw.id ?? 0),
      name: String(leagueRaw.name ?? 'Unknown League'),
      logo: leagueRaw.logo ?? null,
      country: leagueRaw.country_code ?? leagueRaw.country ?? null,
    },
    home: {
      id: Number(homeRaw.id ?? hit.team_home_id ?? 0),
      name: String(homeRaw.name ?? `Team ${hit.team_home_id ?? '?'}`),
      logo: homeRaw.logo ?? null,
    },
    away: {
      id: Number(awayRaw.id ?? hit.team_away_id ?? 0),
      name: String(awayRaw.name ?? `Team ${hit.team_away_id ?? '?'}`),
      logo: awayRaw.logo ?? null,
    },
    score: {
      home: nullableNum(hit.team_home_goals),
      away: nullableNum(hit.team_away_goals),
      htHome: nullableNum(hit.team_home_halftime_goals),
      htAway: nullableNum(hit.team_away_halftime_goals),
    },
    odds: {
      home: nullableNum(hit.odds_home),
      draw: nullableNum(hit.odds_draw),
      away: nullableNum(hit.odds_away),
    },
    predictions: {
      oneXTwo: {
        home: pHome, draw: pDraw, away: pAway,
        pick: oneXTwoPick.pick as 'home' | 'draw' | 'away',
        confidence: oneXTwoPick.confidence,
      },
      doubleChance: {
        homeDraw: pHD, homeAway: pHA, drawAway: pDA,
        pick: dcPick.pick as 'homeDraw' | 'homeAway' | 'drawAway',
        confidence: dcPick.confidence,
      },
      bts: {
        yes: pBtsYes, no: pBtsNo,
        pick: btsPick.pick as 'yes' | 'no',
        confidence: btsPick.confidence,
      },
      overUnder,
    },
    bestPick,
  };
}

export function extractPredictions(hits: Array<Record<string, any>>): Prediction[] {
  if (!Array.isArray(hits)) return [];
  return hits
    .map((h) => { try { return extractPrediction(h); } catch { return null; } })
    .filter((p): p is Prediction => p !== null);
}
