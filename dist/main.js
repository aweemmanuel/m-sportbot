"use strict";
/**
 * Main entry point — boots the Msport Bot system.
 *
 * 1. Load config from .env
 * 2. Initialize Score180 client + predictions service
 * 3. Initialize Msport automation (Playwright)
 * 4. Initialize Telegram bot
 * 5. Start daily push cron
 * 6. Start Express health check server
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const client_1 = require("./client");
const service_1 = require("./predictions/service");
const sqlite_cache_1 = require("./cache/sqlite-cache");
const subscribers_1 = require("./cache/subscribers");
const automation_1 = require("./msport/automation");
const index_1 = require("./bot/index");
const daily_push_1 = require("./bot/daily-push");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
// ---- Config ----
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? 'PLACEHOLDER';
const MSPORT_PHONE = process.env.MSPORT_PHONE ?? '';
const MSPORT_PASSWORD = process.env.MSPORT_PASSWORD ?? '';
const SCORE180_API_URL = process.env.SCORE180_API_URL ?? 'https://api.180score.ai/api/';
const SCORE180_SEARCH_URL = process.env.SCORE180_SEARCH_URL ?? 'https://search.180score.ai';
const SCORE180_SEARCH_KEY = process.env.SCORE180_SEARCH_KEY ?? '4835ec5f70b7d2c8ae9e9fc30ba9d25ef46b';
const CACHE_PATH = process.env.CACHE_PATH ?? './.msport-cache.sqlite';
const PORT = parseInt(process.env.PORT ?? '8080', 10);
const PUSH_HOUR_UTC = parseInt(process.env.PUSH_HOUR_UTC ?? '6', 10);
const PUSH_MINUTE_UTC = parseInt(process.env.PUSH_MINUTE_UTC ?? '0', 10);
const BOOT_BOT = process.env.BOOT_BOT === '1';
const NODE_ENV = process.env.NODE_ENV ?? 'development';
async function main() {
    console.log('='.repeat(50));
    console.log('  MSPORT BOT — Automated Betting System');
    console.log('='.repeat(50));
    console.log(`  Environment: ${NODE_ENV}`);
    console.log(`  Port: ${PORT}`);
    console.log(`  Push time: ${PUSH_HOUR_UTC}:${String(PUSH_MINUTE_UTC).padStart(2, '0')} UTC = ${PUSH_HOUR_UTC + 1}:${String(PUSH_MINUTE_UTC).padStart(2, '0')} Nigerian time`);
    console.log('='.repeat(50));
    // 1. Initialize cache
    console.log('[main] Initializing SQLite cache...');
    const cache = new sqlite_cache_1.SqliteCache(CACHE_PATH);
    // Purge expired entries on startup
    cache.purge();
    // Create subscriber store using same DB
    const rawDb = new better_sqlite3_1.default(CACHE_PATH);
    rawDb.pragma('journal_mode = WAL');
    const subscribers = new subscribers_1.SubscriberStore(rawDb);
    // 2. Initialize Score180 client
    console.log('[main] Initializing Score180 client...');
    const client = new client_1.Score180Client({
        apiUrl: SCORE180_API_URL,
        searchUrl: SCORE180_SEARCH_URL,
        searchKey: SCORE180_SEARCH_KEY,
    });
    // 3. Initialize predictions service
    console.log('[main] Initializing predictions service...');
    const service = new service_1.PredictionsService(client, cache);
    // Quick test: fetch today's predictions
    console.log('[main] Testing Score180 connection...');
    try {
        const preds = await service.list({ limit: 3, minConfidence: 0.90 });
        console.log(`[main] Score180 OK — ${preds.length} predictions found`);
        if (preds.length) {
            console.log(`[main] Sample: ${preds[0].home.name} vs ${preds[0].away.name} — ${preds[0].bestPick.label} (${Math.round(preds[0].bestPick.probability * 100)}%)`);
        }
    }
    catch (error) {
        console.error('[main] Score180 test failed:', error.message);
        console.log('[main] Continuing — predictions will work when API is accessible');
    }
    // 4. Initialize Msport automation
    console.log('[main] Initializing Msport automation...');
    const msportConfig = {
        phone: MSPORT_PHONE,
        password: MSPORT_PASSWORD,
        headless: true, // Always headless in production
    };
    const msport = new automation_1.MsportAutomation(msportConfig);
    // Try to login (will be retried later if it fails)
    try {
        await msport.init();
        console.log('[main] Browser initialized');
        // Note: Don't login immediately on startup — Msport login can be slow
        // and we want the bot to be responsive first. Login will happen when
        // the user taps BET or when balance is requested.
        console.log('[main] Msport session ready — will login on first BET/Balance request');
    }
    catch (error) {
        console.error('[main] Msport init error:', error.message);
        console.log('[main] Msport will reconnect when needed');
    }
    // 5. Initialize Telegram bot
    if (!BOOT_BOT || BOT_TOKEN === 'PLACEHOLDER') {
        console.log('[main] Bot not starting — TELEGRAM_BOT_TOKEN is placeholder or BOOT_BOT != 1');
        console.log('[main] Running in API-only mode');
        startApiServer(service, msport, cache, PORT);
        return;
    }
    console.log('[main] Initializing Telegram bot...');
    const bot = (0, index_1.createBot)({
        botToken: BOT_TOKEN,
        service,
        subscribers,
        msport,
        pushHourUtc: PUSH_HOUR_UTC,
    });
    // Register skip handler
    (0, index_1.registerSkipHandler)(bot);
    // 6. Start daily push
    console.log('[main] Starting daily push cron...');
    const pushTask = (0, daily_push_1.startDailyPush)({
        bot,
        service,
        subscribers,
        msport,
        hourUtc: PUSH_HOUR_UTC,
        minuteUtc: PUSH_MINUTE_UTC,
    });
    // 7. Start health check server
    startApiServer(service, msport, cache, PORT);
    // 8. Launch bot
    console.log('[main] Launching Telegram bot (long-polling)...');
    bot.launch().then(() => {
        console.log('[main] Telegram bot launched!');
    }).catch((error) => {
        console.error('[main] Bot launch error:', error.message);
        console.log('[main] Make sure TELEGRAM_BOT_TOKEN is valid');
    });
    // Graceful shutdown
    const shutdown = async () => {
        console.log('[main] Shutting down...');
        pushTask.stop();
        bot.stop();
        await msport.close();
        cache.close();
        rawDb.close();
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    console.log('[main] System fully operational!');
}
// ---- API Server ----
function startApiServer(service, msport, cache, port) {
    // Simple Express-like server using Node http
    // (no Express dependency needed for health check)
    const http = require('http');
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${port}`);
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/health') {
            const msportReady = msport.isReady();
            const balance = msport.getSession()?.balance;
            res.end(JSON.stringify({
                status: 'ok',
                msport: msportReady ? 'connected' : 'offline',
                balance: balance?.total ?? null,
                cache: 'ok',
                timestamp: Date.now(),
            }));
            return;
        }
        if (url.pathname === '/predictions/today') {
            const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
            const preds = await service.list({ limit, minConfidence: 0.90 });
            res.end(JSON.stringify({ predictions: preds, count: preds.length }));
            return;
        }
        if (url.pathname === '/predictions/safe') {
            const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
            const preds = await service.list({ limit, minConfidence: 0.90 });
            const { transformPredictions } = require('./safety/transformer');
            const safePicks = transformPredictions(preds);
            res.end(JSON.stringify({ safePicks, count: safePicks.length }));
            return;
        }
        if (url.pathname === '/msport/status') {
            const msportReady = msport.isReady();
            const balance = msport.getSession()?.balance;
            res.end(JSON.stringify({
                connected: msportReady,
                balance: balance?.total ?? null,
                minimumBet: msport.getSession()?.minimumBet ?? null,
            }));
            return;
        }
        if (url.pathname === '/cache/purge') {
            const purged = cache.purge();
            res.end(JSON.stringify({ purged }));
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
    });
    server.listen(port, () => {
        console.log(`[api] Health check server listening on http://localhost:${port}`);
    });
}
// ---- Run ----
main().catch((error) => {
    console.error('[main] Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=main.js.map