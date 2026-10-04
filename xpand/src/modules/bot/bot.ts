import { Bot, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { transaction_type } from '@prisma/client';

import { logger } from '../../config/logger.js';
import type { AuthenticatedUser } from '../../types/index.js';
import { listCategories } from '../categories/service.js';
import { getSummary } from '../reports/service.js';
import { createTransaction, deleteTransaction, listTransactions } from '../transactions/service.js';
import { findOrCreateFromTelegram } from '../users/service.js';
import { categoryLabel, esc, money, paymentLabel, shortDate, signedMoney } from './format.js';
import { entryKeyboard, isMiniAppConfigured, openAppKeyboard, savedKeyboard } from './keyboards.js';
import { compatibleCategories, parseQuickEntry, resolveCategory } from './parse.js';

/**
 * The Xpand Telegram bot.
 *
 * Commands are **shortcuts**, not a second application: the Mini App remains the interface for
 * anything involving suppliers, invoices, filtering or editing. What the bot buys is the
 * ability to answer "how much cash do we have?" and to log a straightforward expense without
 * leaving the chat.
 *
 * Handlers call the **service layer directly** rather than looping back through HTTP. The bot
 * runs in the same process, so a self-request would only add a hop and force us to mint
 * credentials for ourselves. Instead each handler resolves `ctx.from` — which Telegram has
 * already authenticated, since updates reach us over a channel keyed by the bot token — into
 * the same `AuthenticatedUser` shape the Express middleware produces. Category compatibility
 * and validation therefore behave identically on both surfaces.
 *
 * Only the commands that *write* need that actor, to stamp authorship. Reads — /balance,
 * /today, /transactions — resolve nothing, because every user sees the same company-wide books.
 */

/** Telegram truncates long messages; keep list replies well inside the 4096-character limit. */
const RECENT_LIMIT = 10;

/**
 * Resolve the Telegram sender into the user a written row is attributed to.
 *
 * Safe to create-on-first-contact here: an update carrying `from` came from Telegram's servers
 * over our bot token, so the identity is verified in the same sense as a valid initData
 * signature.
 */
async function actorFrom(ctx: Context): Promise<AuthenticatedUser> {
  const from = ctx.from;
  if (!from) {
    // Channel posts and a few update types have no sender. Nothing to attribute a row to.
    throw new Error('Update has no sender');
  }

  return findOrCreateFromTelegram({
    id: BigInt(from.id),
    firstName: from.first_name,
    lastName: from.last_name,
    username: from.username,
  });
}

/**
 * "Today" as the reports service sees it.
 *
 * `transaction_date` is a SQL DATE that Prisma reads and writes at UTC midnight, and the
 * reports compute their day boundaries in UTC. A bot update carries no client timezone, so
 * using UTC here is not a compromise but the only way to keep `/expense` and `/today`
 * agreeing with each other. The Mini App, which *does* know the user's timezone, pins its own
 * local day instead — see the note in the bot README.
 */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Usage help for the quick-entry commands, shown whenever parsing fails. */
function usageHint(command: 'income' | 'expense'): string {
  const example = command === 'income' ? '/income 1200 recettes' : '/expense 250 transport taxi';
  return [
    `<b>Usage</b>`,
    `<code>/${command} &lt;amount&gt; &lt;category&gt; [description]</code>`,
    ``,
    `Example: <code>${esc(example)}</code>`,
    `Send <code>/${command}</code> on its own to use the app form instead.`,
  ].join('\n');
}

export interface CreateBotOptions {
  /**
   * Pre-supplied bot identity. Passing it skips grammy's startup `getMe` call, which is what
   * makes the bot constructible offline in tests.
   */
  botInfo?: UserFromGetMe;
}

export function createBot(token: string, options: CreateBotOptions = {}): Bot {
  const bot = options.botInfo ? new Bot(token, { botInfo: options.botInfo }) : new Bot(token);

  /**
   * Error boundary, registered first so it wraps every handler below.
   *
   * This has to be middleware rather than `bot.catch`, because `bot.catch` is consulted on
   * **one** of the two transports. grammy's `handleUpdates` — the long-polling loop — routes a
   * failed update to the registered error handler, but `handleUpdate`, which is what
   * `webhookCallback` calls, rethrows as a `BotError` instead. Under webhooks the throw therefore
   * escapes into the HTTP layer.
   *
   * On a serverless host that was not a logged warning but a hang: the rejection surfaced as an
   * unhandled rejection with no response written, so the function ran to its 60-second limit and
   * Telegram got a 504 — which it retries, re-running a failure that will never succeed. A
   * deterministic error like "user blocked the bot" would loop indefinitely.
   *
   * Catching here means `handleUpdate` resolves normally on both transports, so the webhook
   * answers 200 and the update is not redelivered. `bot.catch` below is kept as a backstop for
   * anything thrown outside this stack.
   */
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      logger.error({ err, update: ctx.update.update_id }, 'Unhandled error in bot handler');
      // Best-effort: if the failure was itself an inability to message this chat, this fails too.
      await ctx
        .reply('Something went wrong handling that. Please try again.')
        .catch(() => undefined);
    }
  });

  // ---------------------------------------------------------------- /start

  /**
   * Two lines on purpose.
   *
   * This used to greet the sender by their Telegram first name and then reprint most of /help
   * under it. Both were wrong for the first thing a user ever sees: the account is shared in
   * practice, so a personal greeting names whoever happened to open the chat rather than the
   * company, and a screen of commands buries the only two facts that matter — what this bot is
   * for, and that /help exists. The full list stayed exactly one command away.
   */
  bot.command('start', async (ctx) => {
    const actor = await actorFrom(ctx);

    const lines = [
      `Hi Xpand user 👋`,
      ``,
      `<b>Xpand</b> tracks the company's cash position — log money with <code>/expense</code> and <code>/income</code>, check it with /balance or /today, open the app for invoices and suppliers, and send /help for the full list.`,
    ];

    if (!isMiniAppConfigured()) {
      lines.push(
        ``,
        `<i>The app isn't linked yet — an administrator needs to set MINI_APP_URL. Commands still work.</i>`,
      );
    }

    const keyboard = entryKeyboard();
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });

    logger.info({ userId: actor.id.toString() }, 'bot /start');
  });

  // ---------------------------------------------------------------- /help

  bot.command('help', async (ctx) => {
    const lines = [
      `<b>Xpand commands</b>`,
      ``,
      `<b>Logging</b>`,
      `<code>/expense &lt;amount&gt; &lt;category&gt; [note]</code>`,
      `<code>/income &lt;amount&gt; &lt;category&gt; [note]</code>`,
      `Both default to today and cash. Send either on its own to open the app form.`,
      ``,
      `<b>Figures</b>`,
      `/balance — cash position, plus all-time in and out`,
      `/today — today's income, expenses and net`,
      `/transactions — the last ${RECENT_LIMIT} entries`,
      ``,
      `<b>Everything else</b>`,
      `Suppliers, products, packaging, invoices, editing and filtering live in the app.`,
      ``,
      `<i>Amounts accept a dot or a comma: 250.50 or 250,50.</i>`,
    ];

    const keyboard = entryKeyboard();
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  });

  // ---------------------------------------------------------------- /balance

  bot.command('balance', async (ctx) => {
    const summary = await getSummary({});

    const lines = [
      `◎ <b>Cash position</b>`,
      `<b>${esc(money(summary.cashPosition, summary.currency))}</b>`,
      ``,
      `Opening balance   ${esc(money(summary.openingBalance, summary.currency))}`,
      `Total in          ${esc(money(summary.totalIncome, summary.currency))}`,
      `Total out         ${esc(money(summary.totalExpenses, summary.currency))}`,
      `Net movement      ${esc(signedMoney(summary.netCashMovement, summary.currency))}`,
      ``,
      `<i>As of ${esc(summary.referenceDate)}. Future-dated entries are excluded.</i>`,
    ];

    const keyboard = openAppKeyboard('◎ Open Xpand', '/');
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  });

  // ---------------------------------------------------------------- /today

  bot.command('today', async (ctx) => {
    const summary = await getSummary({});

    const today = todayUtc();
    const rows = await listTransactions({ from: today, to: today });

    const lines = [
      `📅 <b>Today</b> · ${esc(summary.today.date)}`,
      ``,
      `↓ In    ${esc(money(summary.today.income, summary.currency))}`,
      `↑ Out   ${esc(money(summary.today.expenses, summary.currency))}`,
      `= Net   ${esc(signedMoney(summary.today.net, summary.currency))}`,
      ``,
      rows.length === 0
        ? `<i>Nothing logged yet today.</i>`
        : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · cash position ${esc(money(summary.cashPosition, summary.currency))}`,
    ];

    const keyboard = entryKeyboard();
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  });

  // ---------------------------------------------------------------- /transactions

  bot.command('transactions', async (ctx) => {
    const [rows, categories] = await Promise.all([listTransactions({}), listCategories()]);
    const nameById = new Map(categories.map((c) => [c.id, c.name]));
    const recent = rows.slice(0, RECENT_LIMIT);

    if (recent.length === 0) {
      const keyboard = entryKeyboard();
      await ctx.reply('No transactions yet. Log one with <code>/expense 250 transport</code>.', {
        parse_mode: 'HTML',
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
      return;
    }

    const lines = [`🧾 <b>Last ${recent.length}</b>`, ``];

    for (const row of recent) {
      const sign = row.type === 'INCOME' ? '↓' : '↑';
      const category = categoryLabel(nameById.get(row.category_id) ?? 'unknown');
      const when = shortDate(row.transaction_date);
      const note = row.description ? ` · ${esc(row.description)}` : '';

      lines.push(
        `${sign} <b>${esc(money(row.amount))}</b> · ${esc(category)}`,
        `   <i>${esc(when)} · ${esc(paymentLabel(row.payment_method))}${note}</i>`,
      );
    }

    if (rows.length > recent.length) {
      lines.push(``, `<i>${rows.length - recent.length} more in the app.</i>`);
    }

    const keyboard = openAppKeyboard('≡ All transactions', '/transactions');
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  });

  // ---------------------------------------------------------------- /income and /expense

  /** Shared implementation — the two commands differ only by transaction type and wording. */
  async function handleQuickEntry(ctx: Context, type: transaction_type): Promise<void> {
    const word = type === 'INCOME' ? 'income' : 'expense';
    const actor = await actorFrom(ctx);
    const parsed = parseQuickEntry(ctx.match?.toString() ?? '');

    // --- No arguments: this is the "open the form" shortcut. ---
    if (parsed.kind === 'empty') {
      const keyboard = openAppKeyboard(
        type === 'INCOME' ? '➕ Add income' : '➖ Add expense',
        `/add/${word}`,
      );

      if (!keyboard) {
        await ctx.reply(`The app isn't linked yet. Log it here instead:\n\n${usageHint(word)}`, {
          parse_mode: 'HTML',
        });
        return;
      }

      await ctx.reply(`Tap to open the ${word} form, or type it inline:\n\n${usageHint(word)}`, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    }

    if (parsed.kind === 'error') {
      await ctx.reply(`${parsed.message}\n\n${usageHint(word)}`, { parse_mode: 'HTML' });
      return;
    }

    // Only categories valid for this type — offering an incompatible one would earn a 400
    // from the same rule the API enforces.
    const allCategories = await listCategories();
    const candidates = compatibleCategories(allCategories, type);

    if (candidates.length === 0) {
      await ctx.reply(`No ${word} categories exist yet — one has to be created first.`);
      return;
    }

    const names = candidates.map((c) => c.name).join(', ');
    // Guaranteed present — the empty case returned above — but indexed access is unchecked.
    const sample = candidates[0]?.name ?? 'divers';

    if (parsed.kind === 'needs-category') {
      await ctx.reply(
        [
          `Amount ${esc(money(parsed.amount))} — which category?`,
          ``,
          `<b>Available</b>: ${esc(names)}`,
          ``,
          `<code>/${word} ${parsed.amount} ${esc(sample)}</code>`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
      return;
    }

    const match = resolveCategory(parsed.categoryTerm, candidates);

    if (match.kind === 'none') {
      await ctx.reply(
        [
          `No ${word} category matches "<b>${esc(parsed.categoryTerm)}</b>".`,
          ``,
          `<b>Available</b>: ${esc(names)}`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (match.kind === 'ambiguous') {
      await ctx.reply(
        [
          `"<b>${esc(parsed.categoryTerm)}</b>" matches more than one category:`,
          esc(match.candidates.map((c) => c.name).join(', ')),
          ``,
          `Type more of the name.`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
      return;
    }

    // --- Save. Defaults mirror the Mini App form: today, cash, TND. ---
    const created = await createTransaction(
      {
        categoryId: match.category.id,
        type,
        amount: parsed.amount,
        transactionDate: todayUtc(),
        ...(parsed.description ? { description: parsed.description } : {}),
      },
      actor,
    );

    // Re-read the position so the confirmation shows the effect of what was just logged.
    const summary = await getSummary({});

    const lines = [
      type === 'INCOME' ? `✅ <b>Income logged</b>` : `✅ <b>Expense logged</b>`,
      ``,
      `<b>${esc(signedMoney(type === 'INCOME' ? created.amount : `-${created.amount.toString()}`, created.currency))}</b> · ${esc(categoryLabel(match.category.name))}`,
      `${esc(paymentLabel(created.payment_method))} · ${esc(shortDate(created.transaction_date))}`,
    ];

    if (created.description) lines.push(`<i>${esc(created.description)}</i>`);
    lines.push(``, `Cash position: <b>${esc(money(summary.cashPosition, summary.currency))}</b>`);

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: savedKeyboard(created.id),
    });

    logger.info(
      { userId: actor.id.toString(), transactionId: created.id, type },
      'bot quick entry saved',
    );
  }

  bot.command('income', (ctx) => handleQuickEntry(ctx, 'INCOME'));
  bot.command('expense', (ctx) => handleQuickEntry(ctx, 'EXPENSE'));

  // ---------------------------------------------------------------- undo

  /**
   * Undo a just-logged transaction.
   *
   * `deleteTransaction` re-checks ownership, so a forged callback payload from another user
   * gets the same 404 the HTTP route would give — the button is a convenience, not the
   * authority.
   */
  bot.callbackQuery(/^undo:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);

    try {
      await deleteTransaction(id);
      await ctx.answerCallbackQuery({ text: 'Deleted' });
      // Replace the confirmation so the chat log can't be misread as "still saved".
      await ctx.editMessageText('↩️ <b>Undone</b> — that entry was deleted.', {
        parse_mode: 'HTML',
      });
    } catch {
      // Almost always a double-tap on an already-deleted row.
      await ctx.answerCallbackQuery({ text: 'Already removed', show_alert: false });
      await ctx.editMessageText('↩️ <b>Undone</b> — that entry is no longer there.', {
        parse_mode: 'HTML',
      });
    }
  });

  // ---------------------------------------------------------------- fallbacks

  /** Any other slash command. Plain text is ignored so the bot stays quiet in group chats. */
  bot.on('message:entities:bot_command', async (ctx) => {
    await ctx.reply('Unknown command. Send /help to see what I can do.');
  });

  /**
   * Backstop for the long-polling transport only — see the error-boundary middleware at the top
   * of this function, which is what actually catches handler errors on both transports. This
   * remains for anything grammy raises outside the middleware stack while polling, where an
   * uncaught throw can stop the poller and leave the user looking at silence.
   */
  bot.catch((err) => {
    logger.error(
      { err: err.error, update: err.ctx.update.update_id },
      'Unhandled error in bot handler',
    );
    void err.ctx
      .reply('Something went wrong handling that. Please try again.')
      .catch(() => undefined);
  });

  return bot;
}

/**
 * The command list Telegram shows in the ☰ menu and in autocomplete.
 * Registered at startup via `setMyCommands`.
 */
export const BOT_COMMANDS = [
  { command: 'start', description: 'Get started with Xpand' },
  { command: 'income', description: 'Log income — /income 1200 recettes' },
  { command: 'expense', description: 'Log an expense — /expense 250 transport' },
  { command: 'balance', description: 'Current cash position' },
  { command: 'today', description: "Today's money in and out" },
  { command: 'transactions', description: 'Recent transactions' },
  { command: 'help', description: 'Show all commands' },
] as const;
