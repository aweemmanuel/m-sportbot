/**
 * Msport Automation Layer — handles login, balance tracking, and bet placement.
 *
 * Uses Playwright with stealth approach for Cloudflare bypass.
 * Key features:
 * - Auto-login with phone/password
 * - Balance detection and tracking
 * - Individual bet placement (NOT parlays)
 * - Booking code generation
 * - Minimum bet detection from the site
 */
import { Browser, BrowserContext, Page } from 'playwright';
import { BetPlan } from '../safety/transformer';
export interface MsportConfig {
    phone: string;
    password: string;
    headless: boolean;
}
export interface MsportBalance {
    total: number;
    currency: string;
    lastUpdated: number;
}
export interface MsportBetResult {
    success: boolean;
    bookingCode: string | null;
    stakePerGame: number;
    totalStaked: number;
    gamesPlaced: number;
    errors: string[];
}
export interface MsportSession {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    isLoggedIn: boolean;
    balance: MsportBalance;
    minimumBet: number;
}
export declare class MsportAutomation {
    private session;
    private config;
    private reconnectAttempts;
    constructor(config: MsportConfig);
    /**
     * Initialize browser session with Cloudflare bypass.
     * Uses stealth Chromium with realistic viewport and headers.
     */
    init(): Promise<MsportSession>;
    /**
     * Login to Msport Nigeria.
     * Handles Cloudflare challenge automatically by waiting for it to resolve.
     */
    login(): Promise<boolean>;
    /**
     * Handle Cloudflare challenge page.
     * Cloudflare shows a "checking your browser" page that auto-resolves
     * after a few seconds. We just need to wait for it.
     */
    private handleCloudflare;
    /**
     * Detect current balance from Msport account.
     * Looks for the balance display element on the page.
     */
    detectBalance(): Promise<MsportBalance>;
    /**
     * Detect minimum bet amount from the site.
     * Looks at the betslip minimum stake indicator.
     */
    detectMinimumBet(): Promise<number>;
    /**
     * Place individual bets for each qualifying game.
     * NOT parlays — each game is a separate bet.
     *
     * Process:
     * 1. Navigate to find_matches
     * 2. Search for each game
     * 3. Select the safe market (e.g. Over 0.5)
     * 4. Add to betslip as individual bet
     * 5. Set stake per game
     * 6. Place bet
     * 7. Capture booking code
     */
    placeBets(betPlan: BetPlan): Promise<MsportBetResult>;
    /**
     * Select the safe market on the Msport page.
     * Maps our SafePick market types to Msport DOM elements.
     */
    private selectSafeMarket;
    /**
     * Clear the betslip to start fresh for each individual bet.
     */
    private clearBetslip;
    /**
     * Close browser session.
     */
    close(): Promise<void>;
    /**
     * Check if session is active and logged in.
     */
    isReady(): boolean;
    /**
     * Get current session info.
     */
    getSession(): MsportSession | null;
    /**
     * Reconnect if session was lost.
     */
    reconnect(): Promise<boolean>;
}
//# sourceMappingURL=automation.d.ts.map