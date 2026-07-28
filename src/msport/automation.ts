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

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { SafePick, BetPlan } from '../safety/transformer';

// ---- Types ----

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

// ---- Msport Automation ----

export class MsportAutomation {
  private session: MsportSession | null = null;
  private config: MsportConfig;
  private reconnectAttempts = 0;

  constructor(config: MsportConfig) {
    this.config = config;
  }

  /**
   * Initialize browser session with Cloudflare bypass.
   * Uses stealth Chromium with realistic viewport and headers.
   */
  async init(): Promise<MsportSession> {
    console.log('[msport] Initializing browser session...');

    const browser = await chromium.launch({
      headless: this.config.headless ?? true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-NG',
      timezoneId: 'Africa/Lagos',
      extraHTTPHeaders: {
        'Accept-Language': 'en-NG,en;q=0.9',
      },
    });

    // Anti-detection: remove webdriver flag
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Remove Playwright indicators
      delete (globalThis as any).__playwright;
      delete (globalThis as any).__pw_manual;
    });

    const page = await context.newPage();

    this.session = {
      browser,
      context,
      page,
      isLoggedIn: false,
      balance: { total: 0, currency: 'NGN', lastUpdated: 0 },
      minimumBet: 50, // default, will be detected from site
    };

    return this.session;
  }

  /**
   * Login to Msport Nigeria.
   * Handles Cloudflare challenge automatically by waiting for it to resolve.
   */
  async login(): Promise<boolean> {
    if (!this.session) await this.init();
    const page = this.session!.page;

    console.log('[msport] Navigating to Msport login page...');

    try {
      // Navigate to Msport Nigeria
      await page.goto('https://www.msport.com/ng/', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });

      // Wait for Cloudflare challenge to resolve (if present)
      await this.handleCloudflare(page);

      // Look for login button/modal
      console.log('[msport] Looking for login button...');
      
      // Msport has a login button in the header/nav
      const loginBtn = await page.locator('.m-header-login, .m-login-btn, [class*="login"]').first();
      if (await loginBtn.isVisible({ timeout: 10_000 })) {
        await loginBtn.click();
        await page.waitForTimeout(2000);
      }

      // Fill phone number
      const phoneInput = await page.locator('input[type="tel"], input[type="number"], input[placeholder*="phone"], input[placeholder*="Phone"], input[placeholder*="9"]').first();
      if (await phoneInput.isVisible({ timeout: 5_000 })) {
        await phoneInput.fill(this.config.phone);
        await page.waitForTimeout(500);
      }

      // Fill password
      const pwdInput = await page.locator('input[type="password"]').first();
      if (await pwdInput.isVisible({ timeout: 5_000 })) {
        await pwdInput.fill(this.config.password);
        await page.waitForTimeout(500);
      }

      // Click login/submit button
      const submitBtn = await page.locator('button[type="submit"], .m-login-submit, [class*="submit"]').first();
      if (await submitBtn.isVisible({ timeout: 5_000 })) {
        await submitBtn.click();
        await page.waitForTimeout(5000);
      }

      // Check if login was successful (look for balance indicator or user menu)
      const balanceVisible = await page.locator('.m-balance, [class*="balance"], .m-user-info').first().isVisible({ timeout: 10_000 });
      
      if (balanceVisible) {
        this.session!.isLoggedIn = true;
        console.log('[msport] Login successful!');
        
        // Detect balance immediately
        await this.detectBalance();
        // Detect minimum bet
        await this.detectMinimumBet();
        
        return true;
      } else {
        console.log('[msport] Login may have failed — balance element not visible');
        this.reconnectAttempts++;
        if (this.reconnectAttempts < 3) {
          console.log('[msport] Retrying login...');
          return await this.login();
        }
        return false;
      }

    } catch (error: any) {
      console.error('[msport] Login error:', error.message);
      this.reconnectAttempts++;
      if (this.reconnectAttempts < 3) {
        console.log('[msport] Retrying login...');
        return await this.login();
      }
      return false;
    }
  }

  /**
   * Handle Cloudflare challenge page.
   * Cloudflare shows a "checking your browser" page that auto-resolves
   * after a few seconds. We just need to wait for it.
   */
  private async handleCloudflare(page: Page): Promise<void> {
    // Check if we're on Cloudflare challenge page
    const cfChallenge = await page.locator('#challenge-running, .cf-browser-verification, [class*="challenge"]').first();
    
    if (await cfChallenge.isVisible({ timeout: 3_000 }).catch(() => false)) {
      console.log('[msport] Cloudflare challenge detected — waiting for resolution...');
      // Wait up to 30 seconds for challenge to resolve
      await page.waitForFunction(() => {
        const challenge = document.querySelector('#challenge-running, .cf-browser-verification') as HTMLElement | null;
        return !challenge || challenge.style.display === 'none';
      }, { timeout: 30_000 }).catch(() => {
        console.log('[msport] Cloudflare challenge timeout — proceeding anyway');
      });
      await page.waitForTimeout(3000);
    }
    
    // Also handle the "Verify you are human" checkbox
    const cfCheckbox = await page.locator('#cf-turnstile-response, .cf-turnstile').first();
    if (await cfCheckbox.isVisible({ timeout: 2_000 }).catch(() => false)) {
      console.log('[msport] Cloudflare Turnstile detected — waiting...');
      await page.waitForTimeout(10_000);
    }
  }

  /**
   * Detect current balance from Msport account.
   * Looks for the balance display element on the page.
   */
  async detectBalance(): Promise<MsportBalance> {
    if (!this.session || !this.session.isLoggedIn) {
      return this.session?.balance ?? { total: 0, currency: 'NGN', lastUpdated: 0 };
    }

    const page = this.session.page;

    try {
      // Msport shows balance in various elements
      const balanceSelectors = [
        '.m-balance-amount',
        '.m-user-balance',
        '[class*="balance"]',
        '.m-header-balance',
      ];

      for (const selector of balanceSelectors) {
        const el = await page.locator(selector).first();
        if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
          const text = (await el.textContent().catch(() => '')) ?? '';
          const amount = parseNairaAmount(text);
          if (amount > 0) {
            this.session.balance = {
              total: amount,
              currency: 'NGN',
              lastUpdated: Date.now(),
            };
            console.log(`[msport] Balance detected: ₦${amount}`);
            return this.session.balance;
          }
        }
      }

      // Fallback: try to get balance from page JavaScript
      const jsBalance = await page.evaluate(() => {
        // Vue.js apps often store state in the app instance
        const app = (window as any).__vue_app__ || (window as any).__vue__;
        if (app) {
          const store = app.config?.globalProperties?.$store || app.$store;
          if (store) {
            const state = store.state;
            return state?.user?.balance || state?.balance || null;
          }
        }
        return null;
      }).catch(() => null);

      if (jsBalance && typeof jsBalance === 'number') {
        this.session.balance = {
          total: jsBalance,
          currency: 'NGN',
          lastUpdated: Date.now(),
        };
        console.log(`[msport] Balance from JS: ₦${jsBalance}`);
      }

    } catch (error: any) {
      console.error('[msport] Balance detection error:', error.message);
    }

    return this.session.balance;
  }

  /**
   * Detect minimum bet amount from the site.
   * Looks at the betslip minimum stake indicator.
   */
  async detectMinimumBet(): Promise<number> {
    if (!this.session) return 50;

    const page = this.session.page;

    try {
      // Navigate to find_matches to see bet options
      await page.goto('https://www.msport.com/ng/find_matches', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      await this.handleCloudflare(page);

      // Look for minimum bet indicator
      const minBetSelectors = [
        '.m-betslip-min-stake',
        '[class*="min-stake"]',
        '.m-bet-minimum',
      ];

      for (const selector of minBetSelectors) {
        const el = await page.locator(selector).first();
        if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
          const text = (await el.textContent().catch(() => '')) ?? '';
          const amount = parseNairaAmount(text);
          if (amount > 0) {
            this.session.minimumBet = amount;
            console.log(`[msport] Minimum bet detected: ₦${amount}`);
            return amount;
          }
        }
      }

      // Msport Nigeria default minimum is ₦50
      this.session.minimumBet = 50;
      console.log('[msport] Using default minimum bet: ₦50');
      return 50;

    } catch (error: any) {
      console.error('[msport] Minimum bet detection error:', error.message);
      this.session.minimumBet = 50;
      return 50;
    }
  }

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
  async placeBets(betPlan: BetPlan): Promise<MsportBetResult> {
    if (!this.session || !this.session.isLoggedIn) {
      return {
        success: false,
        bookingCode: null,
        stakePerGame: 0,
        totalStaked: 0,
        gamesPlaced: 0,
        errors: ['Not logged in to Msport'],
      };
    }

    if (betPlan.qualifyingGames === 0) {
      return {
        success: false,
        bookingCode: null,
        stakePerGame: 0,
        totalStaked: 0,
        gamesPlaced: 0,
        errors: ['No qualifying games to bet on'],
      };
    }

    const page = this.session.page;
    const errors: string[] = [];
    let gamesPlaced = 0;
    let totalStaked = 0;
    let bookingCode: string | null = null;

    console.log(`[msport] Starting bet placement for ${betPlan.qualifyingGames} games...`);

    for (const pick of betPlan.picks) {
      try {
        console.log(`[msport] Placing bet #${gamesPlaced + 1}: ${pick.homeTeam} vs ${pick.awayTeam} — ${pick.safePick}`);

        // Navigate to find_matches
        await page.goto('https://www.msport.com/ng/find_matches', {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        await this.handleCloudflare(page);
        await page.waitForTimeout(2000);

        // Clear previous betslip (for individual bets, we clear between each)
        await this.clearBetslip(page);

        // Search for the match
        const searchInput = await page.locator('.m-search-input, input[placeholder*="Search"], input[placeholder*="search"]').first();
        if (await searchInput.isVisible({ timeout: 5_000 })) {
          const searchTerm = `${pick.homeTeam} ${pick.awayTeam}`;
          await searchInput.fill(searchTerm);
          await page.waitForTimeout(3000); // Wait for search results
        }

        // Click on the match result
        const matchCard = await page.locator('.m-hot-event, .m-match-item, [class*="match"]').first();
        if (await matchCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await matchCard.click();
          await page.waitForTimeout(2000);
        }

        // Select the safe market option
        // Based on safeMarket type, click the appropriate odds button
        const marketSelected = await this.selectSafeMarket(page, pick);
        if (!marketSelected) {
          errors.push(`Could not select market for ${pick.homeTeam} vs ${pick.awayTeam}: ${pick.safePick}`);
          continue;
        }

        // Set stake amount
        const stakeInput = await page.locator('.m-betslip-stake-input, input[placeholder*="stake"], input[class*="stake"]').first();
        if (await stakeInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await stakeInput.fill(String(betPlan.stakePerGame));
          await page.waitForTimeout(500);
        }

        // Place the individual bet
        const placeBetBtn = await page.locator('.m-betslip-place-btn, button[class*="place"], [class*="submit-bet"]').first();
        if (await placeBetBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await placeBetBtn.click();
          await page.waitForTimeout(3000);

          // Check for booking code in confirmation
          const codeEl = await page.locator('.m-booking-code, [class*="booking"], [class*="code"]').first();
          if (await codeEl.isVisible({ timeout: 5_000 }).catch(() => false)) {
            const code = (await codeEl.textContent().catch(() => '')) ?? '';
            if (code.trim()) {
              bookingCode = code.trim();
            }
          }

          gamesPlaced++;
          totalStaked += betPlan.stakePerGame;
          console.log(`[msport] Bet #${gamesPlaced} placed successfully: ₦${betPlan.stakePerGame}`);

          // Clear betslip before next bet
          await this.clearBetslip(page);
        } else {
          errors.push(`Place bet button not found for ${pick.homeTeam} vs ${pick.awayTeam}`);
        }

      } catch (error: any) {
        errors.push(`Error placing bet for ${pick.homeTeam} vs ${pick.awayTeam}: ${error.message}`);
        console.error(`[msport] Bet placement error:`, error.message);
      }
    }

    // Update balance after all bets
    await this.detectBalance();

    return {
      success: gamesPlaced > 0,
      bookingCode,
      stakePerGame: betPlan.stakePerGame,
      totalStaked,
      gamesPlaced,
      errors,
    };
  }

  /**
   * Select the safe market on the Msport page.
   * Maps our SafePick market types to Msport DOM elements.
   */
  private async selectSafeMarket(page: Page, pick: SafePick): Promise<boolean> {
    try {
      const safeMarket = pick.safeMarket;
      const safePickLabel = pick.safePick;

      if (safeMarket === 'overUnder') {
        // Over/Under market — look for the O/U section and click the correct odds button
        // Extract line from label: "Over 0.5 Goals" → line = 0.5
        const lineMatch = safePickLabel.match(/(\d+\.\d+)/);
        const line = lineMatch ? parseFloat(lineMatch[1]) : 0.5;
        const isOver = safePickLabel.toLowerCase().includes('over');

        // Look for Over/Under odds buttons
        const ouSection = await page.locator('.m-market-over-under, [class*="over-under"], [class*="goals"]').first();
        if (await ouSection.isVisible({ timeout: 5_000 }).catch(() => false)) {
          // Click the appropriate odds button (Over X.5 or Under X.5)
          const targetLabel = isOver ? `Over ${line}` : `Under ${line}`;
          const oddsBtn = await page.locator(`.m-betslip-ball:has-text("${targetLabel}")`).first();
          if (await oddsBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await oddsBtn.click();
            await page.waitForTimeout(500);
            return true;
          }

          // Fallback: try clicking any Over 0.5 button (safest)
          if (isOver) {
            const over05Btn = await page.locator('.m-betslip-ball:has-text("Over 0.5")').first();
            if (await over05Btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
              await over05Btn.click();
              await page.waitForTimeout(500);
              return true;
            }
          }
        }

        // Alternative approach: try 1X2 Double Chance buttons
        // If Over 0.5 isn't available, try 1X or X2
        if (isOver && line <= 0.5) {
          const dc1XBtn = await page.locator('.m-betslip-ball:has-text("1X")').first();
          if (await dc1XBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await dc1XBtn.click();
            await page.waitForTimeout(500);
            return true;
          }
        }

      } else if (safeMarket === 'doubleChance') {
        // Double Chance market
        const dcBtnSelectors: Record<string, string[]> = {
          '1X (Home or Draw)': ['.m-betslip-ball:has-text("1X")', '[class*="dc-1x"]'],
          '12 (Home or Away)': ['.m-betslip-ball:has-text("12")', '[class*="dc-12"]'],
          'X2 (Draw or Away)': ['.m-betslip-ball:has-text("X2")', '[class*="dc-x2"]'],
        };

        const selectors = dcBtnSelectors[safePickLabel] ?? [];
        for (const sel of selectors) {
          const btn = await page.locator(sel).first();
          if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await btn.click();
            await page.waitForTimeout(500);
            return true;
          }
        }
      }

      // If specific market not found, try Over 0.5 as universal safe fallback
      const fallbackBtn = await page.locator('.m-betslip-ball:has-text("Over 0.5")').first();
      if (await fallbackBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await fallbackBtn.click();
        await page.waitForTimeout(500);
        return true;
      }

      return false;
    } catch (error: any) {
      console.error('[msport] Market selection error:', error.message);
      return false;
    }
  }

  /**
   * Clear the betslip to start fresh for each individual bet.
   */
  private async clearBetslip(page: Page): Promise<void> {
    try {
      const clearBtn = await page.locator('.m-betslip-clear, [class*="clear-betslip"], [class*="remove-all"]').first();
      if (await clearBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await clearBtn.click();
        await page.waitForTimeout(500);
      }
    } catch {
      // Betslip might already be empty
    }
  }

  /**
   * Close browser session.
   */
  async close(): Promise<void> {
    if (this.session) {
      await this.session.browser.close();
      this.session = null;
    }
  }

  /**
   * Check if session is active and logged in.
   */
  isReady(): boolean {
    return this.session !== null && this.session.isLoggedIn;
  }

  /**
   * Get current session info.
   */
  getSession(): MsportSession | null {
    return this.session;
  }

  /**
   * Reconnect if session was lost.
   */
  async reconnect(): Promise<boolean> {
    console.log('[msport] Reconnecting...');
    await this.close();
    this.reconnectAttempts = 0;
    await this.init();
    return await this.login();
  }
}

// ---- Helper Functions ----

/** Parse Naira amount from text like "₦100.00" or "100 NGN" */
function parseNairaAmount(text: string): number {
  if (!text) return 0;
  // Remove currency symbols and parse number
  const cleaned = text.replace(/[₦\sNGN,]/g, '').trim();
  const match = cleaned.match(/(\d+\.?\d*)/);
  if (match) {
    const amount = parseFloat(match[1]);
    return Number.isFinite(amount) ? Math.round(amount) : 0;
  }
  return 0;
}
