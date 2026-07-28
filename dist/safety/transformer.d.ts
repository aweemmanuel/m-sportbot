/**
 * Betting Safety Logic — transforms Score180 predictions into safer bets.
 *
 * RULES:
 * 1. NEVER use original predictions — always edit to be safer
 * 2. Maximum odds allowed: 1.2 (no minimum required)
 * 3. Transformation rules:
 *    - Over 1.5 → Over 0.5 (or "Any team to lead by 1 goal" if available)
 *    - Under 4.5 → Under 6.5 (maximum under available)
 *    - Over 2.5 → Over 0.5 (even safer)
 *    - Under 3.5 → Under 6.5
 *    - 1X2 Home Win → Double Chance 1X (Home or Draw)
 *    - BTS Yes → Over 0.5 Goals (safer, similar concept)
 *    - If any safe pick exceeds 1.2 odds → SKIP that game
 * 4. All games are INDIVIDUAL bets (not parlays)
 * 5. Confidence threshold: 90%+ from API, 95%+ to display
 */
import { Prediction } from '../predictions/extractor';
export interface SafePick {
    fixtureId: number;
    date: string;
    time: string | null;
    league: string;
    homeTeam: string;
    awayTeam: string;
    /** Original prediction from Score180 */
    originalPick: string;
    /** Original confidence (0-1) */
    originalConfidence: number;
    /** Our safer version */
    safePick: string;
    /** Safe pick market type */
    safeMarket: string;
    /** Estimated odds for the safe pick (null if unknown) */
    safeOdds: number | null;
    /** Whether this pick passes the 1.2 odds cap */
    passesOddsCap: boolean;
    /** Reason for the transformation */
    transformationReason: string;
}
export interface BetPlan {
    picks: SafePick[];
    /** Total balance detected from Msport account */
    totalBalance: number;
    /** Number of qualifying games (after odds cap filter) */
    qualifyingGames: number;
    /** Amount per individual bet */
    stakePerGame: number;
    /** Minimum bet allowed by Msport (detected) */
    minimumBet: number;
    /** Booking code for the bet (generated after placing) */
    bookingCode: string | null;
}
/**
 * Transform a Score180 Prediction into a SafePick.
 *
 * Strategy: Take the BEST PICK (highest confidence) and make it SAFER.
 * If the safe version exceeds 1.2 odds, we skip it.
 */
export declare function transformToSafePick(pred: Prediction): SafePick;
/**
 * Batch transform: filter by confidence, then transform each prediction.
 * Returns only qualifying picks (95%+ confidence AND ≤1.2 odds).
 */
export declare function transformPredictions(predictions: Prediction[]): SafePick[];
/**
 * Calculate stake per game based on total balance and number of qualifying games.
 * Respects Msport's minimum bet amount.
 */
export declare function calculateBetPlan(picks: SafePick[], totalBalance: number, minimumBet?: number): BetPlan;
//# sourceMappingURL=transformer.d.ts.map