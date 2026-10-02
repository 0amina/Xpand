# bot module

The Telegram bot. Commands are **shortcuts**, not a second application — the Mini App remains
the interface for suppliers, invoices, editing and filtering. What the bot adds is answering
"how much cash do we have?" and logging a straightforward expense without leaving the chat.

## Files

| File | Role |
| --- | --- |
| `bot.ts` | `createBot()` — every command handler, and the `BOT_COMMANDS` menu list. |
| `parse.ts` | Turns `250.50 transport taxi` into an amount, a category and a note. Pure, no DB. |
| `format.ts` | Money/date/label formatting and HTML escaping for message text. |
| `keyboards.ts` | Inline keyboards, in particular the `web_app` buttons that launch the Mini App. |
| `index.ts` | Lifecycle: polling vs webhook, menu registration, shutdown. |

## Commands

| Command | Behaviour |
| --- | --- |
| `/start` | Greets, creates the user row on first contact, shows the app buttons. |
| `/help` | Full command reference. |
| `/balance` | Cash position, opening balance, all-time in/out/net. |
| `/today` | Today's income, expenses, net, and the number of entries. |
| `/transactions` | The last 10 entries, plus a button into the app for the rest. |
| `/income [amount] [category] [note]` | Logs income, or opens the form when sent bare. |
| `/expense [amount] [category] [note]` | Same, for expenses. |

Quick entry defaults to **today** and **cash**, matching the Mini App form. Anything else —
a different payment method, a back-dated entry, a supplier link — is a job for the app.

```
/expense 250 transport taxi to airport
/expense 250,50 transport          ← comma decimals work
/expense 250                       ← replies asking which category
/expense                           ← opens the Mini App form
```

Category matching widens in stages: exact name, then prefix, then substring. Two matches are
reported as ambiguous rather than guessed — charging the wrong category is worse than one extra
message. Only categories valid for the transaction type are offered, mirroring the API's
category↔type rule so a 400 is unreachable rather than merely handled.

Every confirmation carries an **Undo** button. Chat entry has no review step — an amount is
typed blind into a message — so a mistyped `2500` needs a one-tap fix. The callback re-checks
ownership through `deleteTransaction`, so a forged payload gets the same 404 the HTTP route
would give.

## How handlers reach the database

They call the **service layer directly** (`transactions/service.ts`, `reports/service.ts`, …)
rather than looping back through HTTP. The bot runs in the same process, so a self-request
would only add a hop and force us to mint credentials for ourselves.

Each handler resolves `ctx.from` into the same `AuthenticatedUser` shape the Express middleware
produces, via `findOrCreateFromTelegram`. That is safe to auto-create from because an update
carrying `from` reached us over a channel keyed by the bot token — Telegram has already vouched
for the identity, in the same sense a valid initData signature does. Ownership rules, category
compatibility and validation therefore behave identically on both surfaces.

## Polling vs webhook

`BOT_MODE` picks the transport.

- **polling** (default in development) — we ask Telegram for updates. No public URL needed, so
  it is the only option that works on a laptop. **Exactly one process may poll a given token**:
  a second one makes Telegram return 409 and the two steal each other's updates.
- **webhook** (production) — Telegram POSTs to `BOT_WEBHOOK_URL` + `/telegram/webhook`. The
  route is mounted *before* the rate limiter, since Telegram bursts updates and throttling them
  would silently drop commands; it is protected instead by the secret token grammy verifies on
  every call.

Switching back from webhook to polling clears the registered webhook first (`deleteWebhook`).
Skipping that is the usual cause of "the bot is running but never replies" — Telegram refuses
`getUpdates` while a webhook is set.

## Timezones

Quick entry files under the **UTC** day, and `/balance` and `/today` read UTC boundaries. A bot
update carries no client timezone, so this is not a compromise but the only way to keep the
three agreeing with each other.

The Mini App is different: it *does* know the user's timezone, so it pins its own local day and
sends it explicitly as `?on=`. Near midnight in UTC+1, an entry made in the app and one made
via `/expense` can therefore land on different dates. Logging through one surface consistently
avoids it entirely; fixing it properly needs a per-user timezone column.

## Testing without touching Telegram

`createBot()` accepts a `botInfo` option. Supplying it skips grammy's startup `getMe` call,
which makes the bot constructible offline. Combined with a transformer on `bot.api.config`,
every outgoing call can be intercepted and asserted:

```ts
const bot = createBot('123:FAKE', { botInfo: { id: 1, is_bot: true, first_name: 'T', username: 't' } as never });
bot.api.config.use(async (_prev, method, payload) => {
  captured.push({ method, payload });
  return { ok: true, result: {} } as never;
});
await bot.handleUpdate(syntheticUpdate);
```

Handlers then run against the real services and the real database with nothing leaving the
process. That is how this module was verified before a token existed.
