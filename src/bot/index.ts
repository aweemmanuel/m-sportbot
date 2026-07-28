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

import { Telegraf, Markup, Context as TelegrafContext } from 'telegraf';
import { SubscriberStore } from '../cache/subscribers';
import { PredictionsService } from '../predictions/service';
import { Prediction } from '../predictions/extractor';
import { SafePick, BetPlan, transformPredictions, calculateBetPlan } from '../safety/transformer';
import { MsportAutomation, MsportBetResult, MsportBalance } from '../msport/automation';

const TG_MAX = 4096;
const PCT = (n: number) => `${Math.round(n * 100)}%`;

export interface BotDeps {
  botToken: string;
  service: PredictionsService;
  subscribers: SubscriberStore;
  msport: MsportAutomation;
  pushHourUtc?: number;
}

// ---- State management ----

// Pending bet plans waiting for user confirmation
const pendingPlans: Map<number, BetPlan> = new Map();

export function createBot(deps: BotDeps): Telegraf<TelegrafContext> {
  const { botToken, service, subscribers, msport } = deps;
  const bot = new Telegraf(botToken);

  // =========================================================================
  // /start — greeting + auto-subscribe
  // =========================================================================
  bot.command('start', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    subscribers.add(chatId, ctx.from?.language_code);

    await ctx.reply(
      [
        '⚽ Msport Nigeria Auto-Bet Bot',
        '',
        'Your automated betting assistant with Score180 AI predictions.',
        '',
        'How it works:',
        '1. Bot fetches predictions from Score180 (90%+ confidence)',
        '2. Only shows games with 95%+ confidence',
        '3. Converts predictions to SAFER versions (max 1.2 odds)',
        '4. You confirm with BET button — bot places individual bets',
        '',
        'Commands:',
        '  /menu        — Main menu',
        '  /predictions — Today\'s safe picks',
        '  /balance     — Msport account balance',
        '  /history     — Recent bet history',
        '  /help        — Full command reference',
      ].join('\n'),
    );
  });

  // =========================================================================
  // /menu — main menu with inline buttons
  // =========================================================================
  bot.command('menu', async (ctx) => {
    await ctx.reply(
      '⚽ MSPORT BOT — MAIN MENU',
      Markup.inlineKeyboard([
        [Markup.button.callback('📊 Predictions', 'predictions')],
        [Markup.button.callback('💰 Balance', 'balance')],
        [Markup.button.callback('📜 History', 'history')],
        [Markup.button.callback('⚙️ Settings', 'settings')],
      ]),
    );
  });

  // =========================================================================
  // /help — full command reference
  // =========================================================================
  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '📖 MSPORT BOT — Command Reference',
        '',
        '/start        Welcome message + subscribe',
        '/menu         Main menu with buttons',
        '/predictions  Today\'s safe picks (95%+ confidence)',
        '/balance      Show Msport account balance',
        '/history      Recent bet history',
        '/today        Today\'s fixtures by time',
        '/fixture <id> Full breakdown for one fixture',
        '/subscribe    Opt in to daily push',
        '/unsubscribe  Opt out of daily push',
        '',
        'Betting Logic:',
        '  • Only 95%+ confidence predictions shown',
        '  • All predictions converted to SAFER versions',
        '  • Maximum odds: 1.2 (no minimum)',
        '  • All bets are INDIVIDUAL (not parlays)',
        '  • Balance split equally across games',
      ].join('\n'),
    );
  });

  // =========================================================================
  // /predictions (alias /p) — fetch and show safe picks
  // =========================================================================
  bot.command(['predictions', 'p'], async (ctx) => {
    await handlePredictions(ctx, service, msport);
  });

  // =========================================================================
  // /balance — show Msport account balance
  // =========================================================================
  bot.command('balance', async (ctx) => {
    await handleBalance(ctx, msport);
  });

  // =========================================================================
  // /history — show recent bet history
  // =========================================================================
  bot.command('history', async (ctx) => {
    await handleHistory(ctx, msport);
  });

  // =========================================================================
  // /today — today's fixtures sorted by time
  // =========================================================================
  bot.command('today', async (ctx) => {
    const preds = await service.list({ limit: 15, sort: 'time' });
    if (!preds.length) {
      await ctx.reply('No fixtures scheduled for today.');
      return;
    }
    // Apply safety filter
    const safePicks = transformPredictions(preds);
    if (!safePicks.length) {
      await ctx.reply('No safe picks available today (need 95%+ confidence and ≤1.2 odds).');
      return;
    }
    await sendSafePicksList(ctx, safePicks, 'Today\'s Safe Picks (by time)');
  });

  // =========================================================================
  // /fixture <id> — full breakdown for one fixture
  // =========================================================================
  bot.command('fixture', async (ctx) => {
    const arg = ctx.message && 'text' in ctx.message ? ctx.message.text.split(/\s+/)[1] : '';
    const id = Number(arg);
    if (!Number.isFinite(id) || id <= 0) {
      await ctx.reply('Usage: /fixture <id>   e.g. /fixture 1412996');
      return;
    }
    const p = await service.get(id);
    if (!p) {
      await ctx.reply(`No fixture found with id ${id}.`);
      return;
    }
    const safePicks = transformPredictions([p]);
    if (safePicks.length) {
      await ctx.reply(formatSafePickDetailed(safePicks[0], p));
    } else {
      await ctx.reply(`Fixture #${id} doesn't meet our safety criteria (95%+ confidence, ≤1.2 odds).`);
    }
  });

  // =========================================================================
  // /subscribe / /unsubscribe
  // =========================================================================
  bot.command('subscribe', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    subscribers.add(chatId, ctx.from?.language_code);
    await ctx.reply('✅ Subscribed! Daily safe picks push at 7:00 AM Nigerian time (UTC+1).');
  });

  bot.command('unsubscribe', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const removed = subscribers.remove(chatId);
    await ctx.reply(removed ? '🚫 Unsubscribed. No more daily push.' : 'You weren\'t subscribed.');
  });

  // =========================================================================
  // /ping — health check
  // =========================================================================
  bot.command('ping', async (ctx) => {
    const msportReady = msport.isReady();
    const balance = msport.getSession()?.balance;
    await ctx.reply(
      `pong · subscribers: ${subscribers.count()} · msport: ${msportReady ? 'connected' : 'offline'} · balance: ₦${balance?.total ?? 'unknown'}`,
    );
  });

  // =========================================================================
  // Inline button handlers
  // =========================================================================

  // predictions button
  bot.action('predictions', async (ctx) => {
    await ctx.answerCbQuery();
    await handlePredictions(ctx, service, msport);
  });

  // balance button
  bot.action('balance', async (ctx) => {
    await ctx.answerCbQuery();
    await handleBalance(ctx, msport);
  });

  // history button
  bot.action('history', async (ctx) => {
    await ctx.answerCbQuery();
    await handleHistory(ctx, msport);
  });

  // settings button
  bot.action('settings', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '⚙️ Settings',
      Markup.inlineKeyboard([
        [Markup.button.callback('🔔 Subscribe to daily push', 'subscribe')],
        [Markup.button.callback('🔕 Unsubscribe', 'unsubscribe')],
        [Markup.button.callback('🔄 Reconnect Msport', 'reconnect')],
        [Markup.button.callback('🏠 Back to menu', 'menu')],
      ]),
    );
  });

  // subscribe/unsubscribe actions
  bot.action('subscribe', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    subscribers.add(chatId, ctx.from?.language_code);
    await ctx.answerCbQuery('✅ Subscribed!');
    await ctx.reply('✅ Subscribed! Daily push at 7:00 AM Nigerian time.');
  });

  bot.action('unsubscribe', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    subscribers.remove(chatId);
    await ctx.answerCbQuery('🚫 Unsubscribed');
    await ctx.reply('🚫 Unsubscribed. No more daily push.');
  });

  // reconnect Msport
  bot.action('reconnect', async (ctx) => {
    await ctx.answerCbQuery('Reconnecting...');
    const success = await msport.reconnect();
    await ctx.reply(success ? '✅ Msport reconnected!' : '❌ Failed to reconnect. Try again later.');
  });

  // back to menu
  bot.action('menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '⚽ MSPORT BOT — MAIN MENU',
      Markup.inlineKeyboard([
        [Markup.button.callback('📊 Predictions', 'predictions')],
        [Markup.button.callback('💰 Balance', 'balance')],
        [Markup.button.callback('📜 History', 'history')],
        [Markup.button.callback('⚙️ Settings', 'settings')],
      ]),
    );
  });

  // BET button — confirm and place bets on Msport
  bot.action(/^bet:(.+)$/, async (ctx) => {
    const planKey = ctx.match[1];
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const plan = pendingPlans.get(chatId);
    if (!plan) {
      await ctx.answerCbQuery('No pending bet plan found', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery('Placing bets on Msport...');

    // Place bets on Msport
    const result = await msport.placeBets(plan);

    // Show result
    const msgLines: string[] = [
      result.success ? '✅ BETS PLACED!' : '❌ BET PLACEMENT FAILED',
      '',
      `Games placed: ${result.gamesPlaced}/${plan.qualifyingGames}`,
      `Stake per game: ₦${result.stakePerGame}`,
      `Total staked: ₦${result.totalStaked}`,
    ];

    if (result.bookingCode) {
      msgLines.push(`Booking code: ${result.bookingCode}`);
    }

    if (result.errors.length) {
      msgLines.push('', 'Errors:');
      result.errors.forEach(e => msgLines.push(`  • ${e}`));
    }

    // Show updated balance
    const balance = msport.getSession()?.balance;
    if (balance) {
      msgLines.push('', `Remaining balance: ₦${balance.total}`);
    }

    await ctx.reply(msgLines.join('\n'));

    // Clear pending plan
    pendingPlans.delete(chatId);
  });

  // EDIT button — show picks for review before betting
  bot.action(/^edit:(.+)$/, async (ctx) => {
    const planKey = ctx.match[1];
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const plan = pendingPlans.get(chatId);
    if (!plan) {
      await ctx.answerCbQuery('No pending bet plan found', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery();

    const lines: string[] = [
      '📝 EDIT MODE — Review your picks:',
      '',
      `Total games: ${plan.qualifyingGames}`,
      `Stake per game: ₦${plan.stakePerGame}`,
      `Total staked: ₦${plan.stakePerGame * plan.qualifyingGames}`,
      `Balance: ₦${plan.totalBalance}`,
      '',
    ];

    for (let i = 0; i < plan.picks.length; i++) {
      const p = plan.picks[i];
      lines.push(`${i + 1}. ${p.homeTeam} vs ${p.awayTeam}`);
      lines.push(`   Original: ${p.originalPick} (${PCT(p.originalConfidence)})`);
      lines.push(`   Safe: ${p.safePick} (est. odds ${p.safeOdds ?? '~1.05'})`);
      lines.push(`   Stake: ₦${plan.stakePerGame}`);
      lines.push('');
    }

    lines.push('Reply /confirm to proceed with betting');
    lines.push('Reply /remove <number> to remove a pick');
    lines.push('Reply /cancel to cancel all bets');

    await ctx.reply(lines.join('\n'));
  });

  // Confirm after editing
  bot.command('confirm', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const plan = pendingPlans.get(chatId);
    if (!plan) {
      await ctx.reply('No pending bets. Use /predictions first.');
      return;
    }
    const result = await msport.placeBets(plan);
    await sendBetResult(ctx, result, plan, msport);
    pendingPlans.delete(chatId);
  });

  // Remove a specific pick
  bot.command('remove', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const plan = pendingPlans.get(chatId);
    if (!plan) {
      await ctx.reply('No pending bets to edit.');
      return;
    }
    const num = parseInt(ctx.message?.text?.split(/\s+/)[1] ?? '');
    if (num > 0 && num <= plan.picks.length) {
      const removed = plan.picks.splice(num - 1, 1)[0];
      // Recalculate plan
      const newPlan = calculateBetPlan(plan.picks, plan.totalBalance, plan.minimumBet);
      pendingPlans.set(chatId, newPlan);
      await ctx.reply(`Removed pick #${num}: ${removed.homeTeam} vs ${removed.awayTeam}. New total: ${newPlan.qualifyingGames} games.`);
    } else {
      await ctx.reply(`Invalid number. Use /remove <1-${plan.picks.length}>`);
    }
  });

  // Cancel all pending bets
  bot.command('cancel', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    pendingPlans.delete(chatId);
    await ctx.reply('🚫 All pending bets cancelled.');
  });

  // fixture:<id> inline button — show full breakdown
  bot.action(/^fixture:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const p = await service.get(id);
    if (!p) {
      await ctx.answerCbQuery('Fixture not found', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const safePicks = transformPredictions([p]);
    if (safePicks.length) {
      await ctx.reply(formatSafePickDetailed(safePicks[0], p));
    } else {
      await ctx.reply(`Fixture #${id} doesn't meet our safety criteria.`);
    }
  });

  return bot;
}

// =========================================================================
// Handler functions
// =========================================================================

async function handlePredictions(ctx: TelegrafContext, service: PredictionsService, msport: MsportAutomation): Promise<void> {
  // Step 1: Fetch predictions from Score180
  const preds = await service.list({ limit: 20, sort: 'confidence', minConfidence: 0.90 });

  if (!preds.length) {
    await ctx.reply('No predictions available today. Try again later.');
    return;
  }

  // Step 2: Transform to safe picks (95%+ confidence, ≤1.2 odds)
  const safePicks = transformPredictions(preds);

  if (!safePicks.length) {
    await ctx.reply('No safe picks qualify today (need 95%+ confidence AND ≤1.2 safe odds).');
    return;
  }

  // Step 3: Get balance from Msport
  let balance: number = 100; // fallback
  let minimumBet: number = 50;

  if (msport.isReady()) {
    const bal = await msport.detectBalance();
    balance = bal.total;
    minimumBet = msport.getSession()?.minimumBet ?? 50;
  } else {
    await ctx.reply('⚠️ Msport not connected. Using estimated balance. Tap BET to connect and place bets.');
  }

  // Step 4: Calculate bet plan
  const betPlan = calculateBetPlan(safePicks, balance, minimumBet);

  if (betPlan.qualifyingGames === 0) {
    await ctx.reply(`No qualifying games. Balance: ₦${balance}, Min bet: ₦${minimumBet}`);
    return;
  }

  // Step 5: Store plan and show to user with BET/EDIT buttons
  const chatId = ctx.chat?.id;
  if (chatId) {
    pendingPlans.set(chatId, betPlan);
  }

  await sendSafePicksWithButtons(ctx, betPlan);
}

async function handleBalance(ctx: TelegrafContext, msport: MsportAutomation): Promise<void> {
  if (!msport.isReady()) {
    await ctx.reply('⚠️ Msport not connected. Tap /menu → Settings → Reconnect Msport');
    return;
  }

  const balance = await msport.detectBalance();
  await ctx.reply(
    [
      '💰 MSPORT BALANCE',
      '',
      `Total: ₦${balance.total}`,
      `Currency: ${balance.currency}`,
      `Last updated: ${new Date(balance.lastUpdated).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}`,
      `Min bet: ₦${msport.getSession()?.minimumBet ?? 50}`,
    ].join('\n'),
  );
}

async function handleHistory(ctx: TelegrafContext, msport: MsportAutomation): Promise<void> {
  if (!msport.isReady()) {
    await ctx.reply('⚠️ Msport not connected. Tap /menu → Settings → Reconnect Msport');
    return;
  }

  // TODO: Implement bet history tracking from Msport
  // For now, show placeholder
  await ctx.reply(
    [
      '📜 BET HISTORY',
      '',
      'Feature coming soon — will show:',
      '  • Recent bets placed',
      '  • Win/Loss results',
      '  • Profit/Loss summary',
      '',
      'Use /balance to check current funds.',
    ].join('\n'),
  );
}

async function sendBetResult(ctx: TelegrafContext, result: MsportBetResult, plan: BetPlan, msport: MsportAutomation): Promise<void> {
  const lines: string[] = [
    result.success ? '✅ BETS PLACED!' : '❌ BET PLACEMENT FAILED',
    '',
    `Games placed: ${result.gamesPlaced}/${plan.qualifyingGames}`,
    `Stake per game: ₦${result.stakePerGame}`,
    `Total staked: ₦${result.totalStaked}`,
  ];

  if (result.bookingCode) {
    lines.push(`Booking code: ${result.bookingCode}`);
  }

  if (result.errors.length) {
    lines.push('', 'Errors:');
    result.errors.forEach(e => lines.push(`  • ${e}`));
  }

  const balance = msport.getSession()?.balance;
  if (balance) {
    lines.push('', `Remaining balance: ₦${balance.total}`);
  }

  await ctx.reply(lines.join('\n'));
}

// =========================================================================
// Formatting functions
// =========================================================================

function formatSafePickShort(p: SafePick): string {
  return `${p.homeTeam} vs ${p.awayTeam}\n  Original: ${p.originalPick} (${PCT(p.originalConfidence)})\n  Safe: ${p.safePick} (est. ${p.safeOdds ?? '~1.05'} odds)`;
}

function formatSafePickDetailed(p: SafePick, pred: Prediction): string {
  const lines: string[] = [
    `🏆 ${p.league}`,
    `⚽ ${p.homeTeam} vs ${p.awayTeam}`,
    `📅 ${p.date}  ${p.time ? p.time.slice(0, 5) : '--:--'}`,
    '',
    `⭐ ORIGINAL: ${p.originalPick} — ${PCT(p.originalConfidence)}`,
    `✅ SAFE VERSION: ${p.safePick} — est. ${p.safeOdds ?? '~1.05'} odds`,
    '',
    `Transformation: ${p.transformationReason}`,
    '',
    'All markets:',
    `  1X2: ${PCT(pred.predictions.oneXTwo.home)} / ${PCT(pred.predictions.oneXTwo.draw)} / ${PCT(pred.predictions.oneXTwo.away)}`,
    `  DC:  ${PCT(pred.predictions.doubleChance.homeDraw)} / ${PCT(pred.predictions.doubleChance.homeAway)} / ${PCT(pred.predictions.doubleChance.drawAway)}`,
    `  BTS: ${PCT(pred.predictions.bts.yes)} / ${PCT(pred.predictions.bts.no)}`,
    `  O/U: Over 0.5=${PCT(pred.predictions.overUnder[0]?.over ?? 0)} | Over 1.5=${PCT(pred.predictions.overUnder[1]?.over ?? 0)} | Under 6.5=${PCT(pred.predictions.overUnder[6]?.under ?? 0)}`,
    '',
    `#fixture ${p.fixtureId}`,
  ];
  return lines.join('\n');
}

async function sendSafePicksList(ctx: TelegrafContext, picks: SafePick[], title: string): Promise<void> {
  const header = `${title}\n${'─'.repeat(28)}\n\n`;
  const chunks: string[] = [];
  let current = header;

  for (const p of picks) {
    const line = formatSafePickShort(p) + '\n';
    if (current.length + line.length > TG_MAX - 200) {
      chunks.push(current);
      current = '';
    }
    current += line;
  }
  if (current) chunks.push(current);

  for (let i = 0; i < chunks.length - 1; i++) {
    await ctx.reply(chunks[i]);
  }

  const lastChunk = chunks[chunks.length - 1];
  const buttons = picks.slice(0, 8).map((p) =>
    Markup.button.callback(`#${p.fixtureId} ${p.homeTeam} vs ${p.awayTeam}`.slice(0, 60), `fixture:${p.fixtureId}`)
  );
  const keyboard = Markup.inlineKeyboard(buttons.map((b) => [b]));
  await ctx.reply(lastChunk, keyboard);
}

async function sendSafePicksWithButtons(ctx: TelegrafContext, plan: BetPlan): Promise<void> {
  const lines: string[] = [
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📊  SAFE PICKS — ${plan.picks[0]?.date ?? 'today'}`,
    `📰  ${plan.qualifyingGames} qualifying games (95%+ confidence, ≤1.2 odds)`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ];

  for (let i = 0; i < plan.picks.length; i++) {
    const p = plan.picks[i];
    lines.push(`${i + 1}. ${p.homeTeam} vs ${p.awayTeam}`);
    lines.push(`   Original: ${p.originalPick} (${PCT(p.originalConfidence)})`);
    lines.push(`   Safe: ${p.safePick} (est. ${p.safeOdds ?? '~1.05'} odds)`);
    lines.push(`   Stake: ₦${plan.stakePerGame}`);
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Balance: ₦${plan.totalBalance}`);
  lines.push(`Stake per game: ₦${plan.stakePerGame}`);
  lines.push(`Total staked: ₦${plan.stakePerGame * plan.qualifyingGames}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');

  await ctx.reply(
    lines.join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ BET — Place all bets', `bet:${plan.picks[0]?.date ?? 'today'}`)],
      [Markup.button.callback('📝 EDIT — Review picks first', `edit:${plan.picks[0]?.date ?? 'today'}`)],
      [Markup.button.callback('❌ SKIP — Don\'t bet today', 'skip')],
    ]),
  );
}

// Skip button handler
function registerSkipHandler(bot: Telegraf<TelegrafContext>): void {
  bot.action('skip', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId) pendingPlans.delete(chatId);
    await ctx.answerCbQuery('Skipped today');
    await ctx.reply('🚫 Skipped — no bets today. Next push tomorrow at 7:00 AM Nigerian time.');
  });
}

// =========================================================================
// Daily push
// =========================================================================

export async function sendDigestToChat(
  bot: Telegraf<TelegrafContext>,
  chatId: number,
  service: PredictionsService,
  msport: MsportAutomation,
): Promise<void> {
  const preds = await service.list({ limit: 20, sort: 'confidence', minConfidence: 0.90 });
  if (!preds.length) {
    await bot.telegram.sendMessage(chatId, '📊  No predictions available today. See you tomorrow!');
    return;
  }

  const safePicks = transformPredictions(preds);
  if (!safePicks.length) {
    await bot.telegram.sendMessage(chatId, '📊  No safe picks qualify today (95%+ confidence, ≤1.2 odds needed).');
    return;
  }

  let balance: number = 100;
  let minimumBet: number = 50;
  if (msport.isReady()) {
    const bal = await msport.detectBalance();
    balance = bal.total;
    minimumBet = msport.getSession()?.minimumBet ?? 50;
  }

  const betPlan = calculateBetPlan(safePicks, balance, minimumBet);
  pendingPlans.set(chatId, betPlan);

  // Build digest message
  const date = safePicks[0].date;
  const headerLines = [
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📊  DAILY SAFE PICKS — ${date}`,
    `📰  ${betPlan.qualifyingGames} qualifying games`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ];

  const bodyLines: string[] = [];
  for (let i = 0; i < betPlan.picks.length; i++) {
    const p = betPlan.picks[i];
    bodyLines.push(`${i + 1}. ${p.homeTeam} vs ${p.awayTeam}`);
    bodyLines.push(`   ${p.safePick} (${PCT(p.originalConfidence)}) — est. ${p.safeOdds ?? '~1.05'} odds`);
    bodyLines.push('');
  }

  const footerLines = [
    '━━━━━━━━━━━━━━━━━━━━━━',
    `Balance: ₦${betPlan.totalBalance} | Stake: ₦${betPlan.stakePerGame}/game`,
    `Total: ₦${betPlan.stakePerGame * betPlan.qualifyingGames}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
  ];

  const fullText = [...headerLines, ...bodyLines, ...footerLines].join('\n');
  const chunks = chunkText(fullText, TG_MAX - 100);

  for (let i = 0; i < chunks.length - 1; i++) {
    await bot.telegram.sendMessage(chatId, chunks[i]);
  }

  // Last chunk: attach BET/EDIT/SKIP buttons
  await bot.telegram.sendMessage(
    chatId,
    chunks[chunks.length - 1],
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ BET — Place all bets', `bet:${date}`)],
      [Markup.button.callback('📝 EDIT — Review picks', `edit:${date}`)],
      [Markup.button.callback('❌ SKIP — Don\'t bet today', 'skip')],
    ]),
  );
}

function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n\n', maxLen);
    if (cut < maxLen * 0.5) cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// Export registerSkipHandler for use in main.ts
export { registerSkipHandler };
