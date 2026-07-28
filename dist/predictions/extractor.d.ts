/**
 * Predictions extractor — turns raw MeiliSearch hits into typed Prediction objects.
 * Handles: 1X2, DoubleChance, BTS, OverUnder markets.
 * Maps bpa_key codes to human-readable labels.
 */
export interface TeamRef {
    id: number;
    name: string;
    logo?: string | null;
}
export interface LeagueRef {
    id: number;
    name: string;
    logo?: string | null;
    country?: string | null;
}
export interface ScoreRef {
    home: number | null;
    away: number | null;
    htHome: number | null;
    htAway: number | null;
}
export interface OddsRef {
    home: number | null;
    draw: number | null;
    away: number | null;
}
export interface MarketPick {
    market: string;
    label: string;
    probability: number;
    odds: number | null;
    pick: string;
}
export interface Prediction1x2 {
    home: number;
    draw: number;
    away: number;
    pick: 'home' | 'draw' | 'away';
    confidence: number;
}
export interface PredictionDoubleChance {
    homeDraw: number;
    homeAway: number;
    drawAway: number;
    pick: 'homeDraw' | 'homeAway' | 'drawAway';
    confidence: number;
}
export interface PredictionBts {
    yes: number;
    no: number;
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
export declare function extractPrediction(hit: Record<string, any>): Prediction;
export declare function extractPredictions(hits: Array<Record<string, any>>): Prediction[];
//# sourceMappingURL=extractor.d.ts.map