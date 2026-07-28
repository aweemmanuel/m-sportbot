"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformToSafePick = transformToSafePick;
exports.transformPredictions = transformPredictions;
exports.calculateBetPlan = calculateBetPlan;
// ---- Constants ----
const MAX_ODDS = 1.2;
const MIN_CONFIDENCE_FETCH = 0.90;
const MIN_CONFIDENCE_DISPLAY = 0.95;
// ---- Transformation Rules ----
/**
 * Transform a Score180 Prediction into a SafePick.
 *
 * Strategy: Take the BEST PICK (highest confidence) and make it SAFER.
 * If the safe version exceeds 1.2 odds, we skip it.
 */
function transformToSafePick(pred) {
    const best = pred.bestPick;
    const market = best.market;
    const originalLabel = best.label;
    const confidence = best.probability;
    let safePick;
    let safeMarket;
    let safeOdds;
    let reason;
    // ---- Market-specific transformation ----
    if (market === 'overUnder') {
        // Over/Under predictions
        const ouPreds = pred.predictions.overUnder;
        safeOdds = best.odds; // will be adjusted below
        if (best.pick === 'over') {
            // Original is "Over X.5" — make it "Over 0.5" (virtually guaranteed)
            // Over 0.5 means "at least 1 goal in the match" — extremely safe
            const over05 = ouPreds.find(o => o.line === 0.5);
            if (over05 && over05.over >= MIN_CONFIDENCE_DISPLAY) {
                safePick = 'Over 0.5 Goals';
                safeMarket = 'overUnder';
                safeOdds = estimateSafeOdds(over05.over, 'over', 0.5);
                reason = `Original "${originalLabel}" → Over 0.5 (at least 1 goal, ${Math.round(over05.over * 100)}% confidence)`;
            }
            else {
                // Fallback: use the lowest available Over line that's ≥95%
                const safeOU = findLowestSafeOver(ouPreds);
                safePick = safeOU ? `Over ${safeOU.line} Goals` : 'Over 0.5 Goals';
                safeMarket = 'overUnder';
                safeOdds = safeOU ? estimateSafeOdds(safeOU.over, 'over', safeOU.line) : estimateSafeOdds(0.99, 'over', 0.5);
                reason = safeOU
                    ? `Original "${originalLabel}" → Over ${safeOU.line} (${Math.round(safeOU.over * 100)}% confidence)`
                    : `Original "${originalLabel}" → Over 0.5 (safest possible)`;
            }
        }
        else {
            // Original is "Under X.5" — make it Under 6.5 (maximum under available)
            // Under 6.5 means "no more than 6 goals" — almost guaranteed
            const under65 = ouPreds.find(o => o.line === 6.5);
            if (under65 && under65.under >= MIN_CONFIDENCE_DISPLAY) {
                safePick = 'Under 6.5 Goals';
                safeMarket = 'overUnder';
                safeOdds = estimateSafeOdds(under65.under, 'under', 6.5);
                reason = `Original "${originalLabel}" → Under 6.5 (max goals 6, ${Math.round(under65.under * 100)}% confidence)`;
            }
            else {
                // Fallback: use the highest available Under line that's ≥95%
                const safeOU = findHighestSafeUnder(ouPreds);
                safePick = safeOU ? `Under ${safeOU.line} Goals` : 'Under 6.5 Goals';
                safeMarket = 'overUnder';
                safeOdds = safeOU ? estimateSafeOdds(safeOU.under, 'under', safeOU.line) : estimateSafeOdds(0.99, 'under', 6.5);
                reason = safeOU
                    ? `Original "${originalLabel}" → Under ${safeOU.line} (${Math.round(safeOU.under * 100)}% confidence)`
                    : `Original "${originalLabel}" → Under 6.5 (maximum under)`;
            }
        }
    }
    else if (market === '1x2') {
        // 1X2 predictions — convert to Double Chance (covers 2 outcomes instead of 1)
        const dc = pred.predictions.doubleChance;
        if (best.pick === 'home') {
            // Home Win → 1X (Home or Draw) — covers 2 of 3 outcomes
            const dcConf = dc.homeDraw;
            safePick = '1X (Home or Draw)';
            safeMarket = 'doubleChance';
            safeOdds = estimateSafeOdds(dcConf, 'doubleChance', 0);
            reason = `Original "Home Win" → 1X (Home or Draw, covers 2 outcomes, ${Math.round(dcConf * 100)}% confidence)`;
        }
        else if (best.pick === 'away') {
            // Away Win → X2 (Draw or Away)
            const dcConf = dc.drawAway;
            safePick = 'X2 (Draw or Away)';
            safeMarket = 'doubleChance';
            safeOdds = estimateSafeOdds(dcConf, 'doubleChance', 0);
            reason = `Original "Away Win" → X2 (Draw or Away, covers 2 outcomes, ${Math.round(dcConf * 100)}% confidence)`;
        }
        else {
            // Draw → 1X or X2 (whichever has higher DC confidence)
            const dcConf = Math.max(dc.homeDraw, dc.drawAway);
            safePick = dc.homeDraw >= dc.drawAway ? '1X (Home or Draw)' : 'X2 (Draw or Away)';
            safeMarket = 'doubleChance';
            safeOdds = estimateSafeOdds(dcConf, 'doubleChance', 0);
            reason = `Original "Draw" → ${safePick} (${Math.round(dcConf * 100)}% confidence)`;
        }
    }
    else if (market === 'doubleChance') {
        // Double Chance is already safer than 1X2, but check if there's an even safer option
        const dc = pred.predictions.doubleChance;
        const dcConf = best.pick === 'homeDraw' ? dc.homeDraw
            : best.pick === 'homeAway' ? dc.homeAway
                : dc.drawAway;
        // If DC confidence ≥ 95%, it's already safe enough — just verify odds cap
        // If DC confidence < 95%, try Over 0.5 as fallback
        const ouPreds = pred.predictions.overUnder;
        const over05 = ouPreds.find(o => o.line === 0.5);
        if (over05 && over05.over >= MIN_CONFIDENCE_DISPLAY && dcConf < over05.over) {
            safePick = 'Over 0.5 Goals';
            safeMarket = 'overUnder';
            safeOdds = estimateSafeOdds(over05.over, 'over', 0.5);
            reason = `Original "${originalLabel}" → Over 0.5 (even safer, ${Math.round(over05.over * 100)}% confidence)`;
        }
        else {
            safePick = originalLabel;
            safeMarket = 'doubleChance';
            safeOdds = estimateSafeOdds(dcConf, 'doubleChance', 0);
            reason = `Original "${originalLabel}" kept (already Double Chance, ${Math.round(dcConf * 100)}% confidence)`;
        }
    }
    else if (market === 'bts') {
        // BTS Yes → Over 0.5 Goals (both mean goals will be scored, Over 0.5 is safer)
        // BTS No → Under 6.5 Goals (both mean fewer goals, Under 6.5 is safer)
        const ouPreds = pred.predictions.overUnder;
        if (best.pick === 'yes') {
            const over05 = ouPreds.find(o => o.line === 0.5);
            safePick = 'Over 0.5 Goals';
            safeMarket = 'overUnder';
            safeOdds = over05 ? estimateSafeOdds(over05.over, 'over', 0.5) : estimateSafeOdds(0.95, 'over', 0.5);
            reason = `Original "Both Teams To Score — Yes" → Over 0.5 (at least 1 goal, safer)`;
        }
        else {
            const under65 = ouPreds.find(o => o.line === 6.5);
            safePick = 'Under 6.5 Goals';
            safeMarket = 'overUnder';
            safeOdds = under65 ? estimateSafeOdds(under65.under, 'under', 6.5) : estimateSafeOdds(0.95, 'under', 6.5);
            reason = `Original "Both Teams To Score — No" → Under 6.5 (maximum under)`;
        }
    }
    else {
        // Unknown market — safest fallback is Over 0.5
        const ouPreds = pred.predictions.overUnder;
        const over05 = ouPreds.find(o => o.line === 0.5);
        safePick = 'Over 0.5 Goals';
        safeMarket = 'overUnder';
        safeOdds = over05 ? estimateSafeOdds(over05.over, 'over', 0.5) : estimateSafeOdds(0.95, 'over', 0.5);
        reason = `Unknown market → Over 0.5 (safest possible fallback)`;
    }
    // Check odds cap
    const passesOddsCap = safeOdds === null || safeOdds <= MAX_ODDS;
    return {
        fixtureId: pred.fixtureId,
        date: pred.date,
        time: pred.time,
        league: pred.league.name,
        homeTeam: pred.home.name,
        awayTeam: pred.away.name,
        originalPick: originalLabel,
        originalConfidence: confidence,
        safePick,
        safeMarket,
        safeOdds,
        passesOddsCap,
        transformationReason: reason,
    };
}
/**
 * Batch transform: filter by confidence, then transform each prediction.
 * Returns only qualifying picks (95%+ confidence AND ≤1.2 odds).
 */
function transformPredictions(predictions) {
    return predictions
        // Step 1: Only fetch predictions with 90%+ confidence
        .filter(p => p.bestPick.probability >= MIN_CONFIDENCE_FETCH)
        // Step 2: Transform each to safer version
        .map(transformToSafePick)
        // Step 3: Only display predictions with 95%+ confidence
        .filter(sp => sp.originalConfidence >= MIN_CONFIDENCE_DISPLAY)
        // Step 4: Only keep picks that pass the 1.2 odds cap
        .filter(sp => sp.passesOddsCap);
}
/**
 * Calculate stake per game based on total balance and number of qualifying games.
 * Respects Msport's minimum bet amount.
 */
function calculateBetPlan(picks, totalBalance, minimumBet = 50) {
    const qualifyingPicks = picks.filter(sp => sp.passesOddsCap);
    const numGames = qualifyingPicks.length;
    if (numGames === 0) {
        return {
            picks: [],
            totalBalance,
            qualifyingGames: 0,
            stakePerGame: 0,
            minimumBet,
            bookingCode: null,
        };
    }
    // Split total balance across all qualifying games
    // Each game gets: totalBalance / numGames
    // But must be at least minimumBet per game
    let stakePerGame = Math.floor(totalBalance / numGames);
    // If stake per game is less than minimum, reduce number of games
    if (stakePerGame < minimumBet) {
        // Calculate max games we can afford at minimum bet
        const maxAffordableGames = Math.floor(totalBalance / minimumBet);
        if (maxAffordableGames <= 0) {
            return {
                picks: [],
                totalBalance,
                qualifyingGames: 0,
                stakePerGame: 0,
                minimumBet,
                bookingCode: null,
            };
        }
        // Take only the top games (sorted by confidence) that we can afford
        const affordablePicks = qualifyingPicks
            .sort((a, b) => b.originalConfidence - a.originalConfidence)
            .slice(0, maxAffordableGames);
        stakePerGame = minimumBet;
        return {
            picks: affordablePicks,
            totalBalance,
            qualifyingGames: affordablePicks.length,
            stakePerGame,
            minimumBet,
            bookingCode: null,
        };
    }
    // Ensure we don't exceed total balance
    const totalStaked = stakePerGame * numGames;
    if (totalStaked > totalBalance) {
        stakePerGame = minimumBet;
    }
    return {
        picks: qualifyingPicks,
        totalBalance,
        qualifyingGames: numGames,
        stakePerGame,
        minimumBet,
        bookingCode: null,
    };
}
// ---- Odds Estimation ----
/**
 * Estimate odds for a safe pick based on confidence probability.
 * Formula: odds ≈ 1 / probability (simplified)
 *
 * For extremely safe picks (99%+), odds will be ~1.01-1.05
 * For moderately safe picks (95%), odds will be ~1.05-1.10
 *
 * Note: These are estimates. Actual Msport odds will vary.
 * The bot will check actual odds before placing bets.
 */
function estimateSafeOdds(confidence, market, line) {
    // Very safe predictions have very low odds
    if (confidence >= 0.99)
        return 1.02;
    if (confidence >= 0.97)
        return 1.04;
    if (confidence >= 0.95)
        return 1.07;
    if (confidence >= 0.90)
        return 1.10;
    // General formula: odds = 1/probability with some margin
    const rawOdds = 1 / confidence;
    // Add bookmaker margin (~5-10%)
    return Math.min(rawOdds * 0.9, MAX_ODDS);
}
// ---- Helper Functions ----
/** Find the lowest Over line with ≥95% confidence */
function findLowestSafeOver(ouPreds) {
    // Sort ascending by line, find first with over ≥ 95%
    const sorted = [...ouPreds].sort((a, b) => a.line - b.line);
    for (const ou of sorted) {
        if (ou.over >= MIN_CONFIDENCE_DISPLAY)
            return ou;
    }
    return null;
}
/** Find the highest Under line with ≥95% confidence */
function findHighestSafeUnder(ouPreds) {
    // Sort descending by line, find first with under ≥ 95%
    const sorted = [...ouPreds].sort((a, b) => b.line - a.line);
    for (const ou of sorted) {
        if (ou.under >= MIN_CONFIDENCE_DISPLAY)
            return ou;
    }
    return null;
}
//# sourceMappingURL=transformer.js.map