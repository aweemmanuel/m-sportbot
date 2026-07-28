/**
 * Daily push — broadcasts safe predictions to all subscribers at 7:00 AM Nigerian time (UTC+1 = 06:00 UTC).
 */

import cron from 'node-cron';
import { Telegraf, Context as TelegrafContext } from 'telegraf';
import { SubscriberStore } from '../cache/subscribers';
import { PredictionsService } from '../predictions/service';
import { MsportAutomation } from '../msport/automation';
import { sendDigestToChat } from '../bot/index';

export interface DailyPushDeps {
  bot: Telegraf<TelegrafContext>;
  service: PredictionsService;
  subscribers: SubscriberStore;
  msport: MsportAutomation;
  /** UTC hour. Default 6 (= 7:00 AM Nigerian time) */
  hourUtc?: number;
  minuteUtc?: number;
}

export function startDailyPush(deps: DailyPushDeps): cron.ScheduledTask {
  const hour = deps.hourUtc ?? 6; // 6 UTC = 7 AM Nigeria
  const minute = deps.minuteUtc ?? 0;

  if (hour < 0 || hour > 23) throw new Error(`Invalid PUSH_HOUR_UTC: ${hour}`);
  if (minute < 0 || minute > 59) throw new Error(`Invalid PUSH_MINUTE_UTC: ${minute}`);

  const expr = `${minute} ${hour} * * *`;
  if (!cron.validate(expr)) throw new Error(`Invalid cron: ${expr}`);

  console.log(`[daily-push] scheduled "${expr}" (UTC) = ${hour + 1}:00 Nigerian time · ${deps.subscribers.count()} subscriber(s)`);

  return cron.schedule(expr, async () => {
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
        await sendDigestToChat(deps.bot, s.chatId, deps.service, deps.msport);
        ok++;
        await sleep(50);
      } catch (err: any) {
        failed++;
        const desc = err?.response?.data?.description ?? err?.message ?? String(err);
        console.error(`[daily-push] failed for chat ${s.chatId}:`, desc);

        if (
          err?.response?.data?.error_code === 403 ||
          /chat not found|bot was blocked/i.test(String(desc))
        ) {
          console.warn(`[daily-push] removing blocked chat ${s.chatId}`);
          deps.subscribers.remove(s.chatId);
        }
      }
    }
    console.log(`[daily-push] done · ok=${ok} failed=${failed}`);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
