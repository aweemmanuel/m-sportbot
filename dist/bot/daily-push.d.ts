/**
 * Daily push — broadcasts safe predictions to all subscribers at 7:00 AM Nigerian time (UTC+1 = 06:00 UTC).
 */
import cron from 'node-cron';
import { Telegraf, Context as TelegrafContext } from 'telegraf';
import { SubscriberStore } from '../cache/subscribers';
import { PredictionsService } from '../predictions/service';
import { MsportAutomation } from '../msport/automation';
export interface DailyPushDeps {
    bot: Telegraf<TelegrafContext>;
    service: PredictionsService;
    subscribers: SubscriberStore;
    msport: MsportAutomation;
    /** UTC hour. Default 6 (= 7:00 AM Nigerian time) */
    hourUtc?: number;
    minuteUtc?: number;
}
export declare function startDailyPush(deps: DailyPushDeps): cron.ScheduledTask;
//# sourceMappingURL=daily-push.d.ts.map