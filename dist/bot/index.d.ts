/**
 * Telegram Bot — Msport Nigeria automated betting bot.
 *
 * Features:
 * - Daily prediction push (95%+ confidence, safe transformations)
 * - BET button → confirm and auto-place individual bets on Msport
 * - EDIT button → review and modify picks before betting
 * - /MENU → main menu with all options
 * - Balance → show current Msport account balance
 * - History → show recent bet history
 * - Nigerian timezone (UTC+1)
 */
import { Telegraf, Context as TelegrafContext } from 'telegraf';
import { SubscriberStore } from '../cache/subscribers';
import { PredictionsService } from '../predictions/service';
import { MsportAutomation } from '../msport/automation';
export interface BotDeps {
    botToken: string;
    service: PredictionsService;
    subscribers: SubscriberStore;
    msport: MsportAutomation;
    pushHourUtc?: number;
}
export declare function createBot(deps: BotDeps): Telegraf<TelegrafContext>;
declare function registerSkipHandler(bot: Telegraf<TelegrafContext>): void;
export declare function sendDigestToChat(bot: Telegraf<TelegrafContext>, chatId: number, service: PredictionsService, msport: MsportAutomation): Promise<void>;
export { registerSkipHandler };
//# sourceMappingURL=index.d.ts.map