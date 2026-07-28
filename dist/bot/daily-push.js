"use strict";
/**
 * Daily push — broadcasts safe predictions to all subscribers at 7:00 AM Nigerian time (UTC+1 = 06:00 UTC).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDailyPush = startDailyPush;
const node_cron_1 = __importDefault(require("node-cron"));
const index_1 = require("../bot/index");
function startDailyPush(deps) {
    const hour = deps.hourUtc ?? 6; // 6 UTC = 7 AM Nigeria
    const minute = deps.minuteUtc ?? 0;
    if (hour < 0 || hour > 23)
        throw new Error(`Invalid PUSH_HOUR_UTC: ${hour}`);
    if (minute < 0 || minute > 59)
        throw new Error(`Invalid PUSH_MINUTE_UTC: ${minute}`);
    const expr = `${minute} ${hour} * * *`;
    if (!node_cron_1.default.validate(expr))
        throw new Error(`Invalid cron: ${expr}`);
    console.log(`[daily-push] scheduled "${expr}" (UTC) = ${hour + 1}:00 Nigerian time · ${deps.subscribers.count()} subscriber(s)`);
    return node_cron_1.default.schedule(expr, async () => {
        const subs = deps.subscribers.list();
        if (!subs.length) {
            console.log('[daily-push] no subscribers, skipping');
            return;
        }
        // Ensure Msport is connected before pushing
        if (!deps.msport.isReady()) {
            console.log('[daily-push] reconnecting Msport...');
            await deps.msport.reconnect();
        }
        console.log(`[daily-push] pushing to ${subs.length} chat(s)…`);
        let ok = 0;
        let failed = 0;
        for (const s of subs) {
            try {
                await (0, index_1.sendDigestToChat)(deps.bot, s.chatId, deps.service, deps.msport);
                ok++;
                await sleep(50);
            }
            catch (err) {
                failed++;
                const desc = err?.response?.data?.description ?? err?.message ?? String(err);
                console.error(`[daily-push] failed for chat ${s.chatId}:`, desc);
                if (err?.response?.data?.error_code === 403 ||
                    /chat not found|bot was blocked/i.test(String(desc))) {
                    console.warn(`[daily-push] removing blocked chat ${s.chatId}`);
                    deps.subscribers.remove(s.chatId);
                }
            }
        }
        console.log(`[daily-push] done · ok=${ok} failed=${failed}`);
    });
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=daily-push.js.map