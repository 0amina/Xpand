# Xpand — Frontend

Telegram Mini App frontend for **Xpand**, the internal tool for tracking the company's daily
cash position. It pairs with the [`xpand`](../xpand) backend and is built around one goal:
**log an income or expense in as few taps as possible**, dozens of times a day.

## Overview

|               |                                                                                        |
| ------------- | -------------------------------------------------------------------------------------- |
| **Framework** | React 19 + TypeScript (strict)                                                         |
| **Build**     | Vite 6                                                                                 |
| **Data**      | TanStack Query v5                                                                      |
| **Routing**   | React Router v7                                                                        |
| **Styling**   | Plain CSS with design tokens — no UI framework                                         |
| **Telegram**  | `telegram-web-app.js` via CDN, wrapped in [`src/lib/telegram.ts`](src/lib/telegram.ts) |

No component library and no CSS framework, deliberately: a Mini App has to adopt Telegram's
theme (which the user can change at runtime, in either light or dark), and shipping a design
system just to override it costs bundle size and fights the host. The whole UI is ~28 KB of
CSS built on `--tg-theme-*` variables with light/dark fallbacks.

## Setup

The backend must be running first — see [`../xpand/README.md`](../xpand/README.md).

```bash
npm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
npm run dev               # http://localhost:5173
```

`http://localhost:5173` is already whitelisted in the backend's `CORS_ORIGINS`, so no backend
change is needed for local work.

### Scripts

| Script              | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Vite dev server with HMR on port 5173.        |
| `npm run build`     | Type-check (`tsc -b`) then bundle to `dist/`. |
| `npm run preview`   | Serve the production build on port 4173.      |
| `npm run typecheck` | Types only, no emit.                          |
| `npm run lint`      | ESLint over the whole project.                |
| `npm run format`    | Prettier.                                     |
| `npm run smoke`     | jsdom against the built bundle — see below.   |

### Environment variables

Only `VITE_`-prefixed variables reach the browser, and **everything here ships inside the JS
bundle** — never put a secret in it.

| Variable               | Default                 | Description                                                                                |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `VITE_API_BASE_URL`    | `http://localhost:3000` | Backend origin.                                                                            |
| `VITE_DEV_TELEGRAM_ID` | —                       | Dev only. Skips the sign-in screen and boots as this Telegram id. Ignored inside Telegram. |
| `VITE_DEV_FIRST_NAME`  | `Dev`                   | Name used if `VITE_DEV_TELEGRAM_ID` is new to the backend.                                 |

Vite **inlines these at build time**, so changing one on the host does nothing until the app is
rebuilt. On Vercel that means a redeploy, not just an edit in the dashboard — the single most
common way a deployed Mini App ends up still calling `localhost:3000`.

## Deployment (Vercel)

A static SPA, so there is almost nothing to configure: Root Directory `xpandFront`, and Vercel's
Vite preset handles the rest. [vercel.json](vercel.json) adds two things the preset does not:

- a catch-all rewrite to `index.html`, so a deep link like `/history` is served by the app rather
  than 404-ing. Rewrites are evaluated **after** the filesystem, so real asset requests still win.
- a year-long `immutable` cache on `/assets/*`, which is safe because Vite content-hashes those
  filenames and unsafe for anything else.

Set `VITE_API_BASE_URL` to the backend's URL **before** the deploy you intend to keep, for the
reason above. The backend in turn needs this app's origin in its `CORS_ORIGINS` and `MINI_APP_URL`,
and @BotFather needs it as the Web App URL — see the backend README's Deployment section for the
order the two have to be brought up in.

## Authentication

Two paths, matching the backend's two accepted credentials. Both live in
[`src/providers/AuthProvider.tsx`](src/providers/AuthProvider.tsx) and
[`src/lib/api.ts`](src/lib/api.ts); nothing else in the app reads the identity directly.

**Inside Telegram** — take the signed `initData` string, send it as `Authorization: tma <initData>`,
and fetch `/api/users/me`. That one call both proves who you are (the backend verifies the HMAC
against the bot token) and creates the user row on first contact, so there is no login step.

The string must be forwarded **byte for byte**: the signature covers the values exactly as
Telegram encoded them, so decoding or re-encoding it invalidates it. `initDataUnsafe` is the
same payload with the signature stripped — fine for painting a name on screen, never for
identity.

Signatures expire after 24 hours. The app then shows "Your session has expired — please reopen
the app", which is the only fix: `initData` is fixed for the lifetime of a Mini App session.

**In a browser tab** — no initData exists, so fall back to `VITE_DEV_TELEGRAM_ID`, then a
previously entered id, then the dev sign-in screen. This path posts to `/api/users/login` first,
because the backend refuses to auto-create a user from an unsigned header. That header is
**rejected outright when the backend runs in production**, so this is a development convenience
only.

There are no roles and nothing to grant: once signed in, a user can read and write every
record — all transactions, the company-wide reports, and every category, supplier, product and
packaging row. The API returns no 403 for permissions, so the UI has no privileged state to
branch on.

## Screens

| Route                    | Screen                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `/`                      | Dashboard — cash position, today's in/out/net, this month, quick actions, recent transactions |
| `/add/income`            | Add income                                                                                    |
| `/add/expense`           | Add expense (adds supplier / product / packaging, and an invoice reference)                   |
| `/transactions`          | History — filter by type, date range, category; grouped by day with daily nets                |
| `/transactions/:id`      | Detail — every field, edit, delete                                                            |
| `/transactions/:id/edit` | Edit                                                                                          |
| `/invoices`              | Invoice queue — what is uploaded, what still needs reviewing                                  |
| `/invoices/scan`         | Photograph or pick an invoice and upload it                                                   |
| `/invoices/:id/review`   | **The verification step** — check what OCR read, then save                                    |

### Why four tabs instead of three

The obvious tab bar is Home / Add / History, with an income-or-expense choice inside "Add".
That costs an extra tap on the single most repeated action in the app, so **Income and Expense
each get their own tab**. Logging anything is one tap from anywhere.

### What makes entry fast

- **A custom numeric keypad** rather than `<input type="number">`. The OS keyboard resizes the
  webview every time it opens (the most complained-about Mini App behaviour), Android hides the
  decimal separator behind a long-press in some locales and returns a comma where the API needs
  a dot, and these targets are ~2× the height of a system key. Rules live in
  [`src/lib/amount.ts`](src/lib/amount.ts), separated from the component so they are testable.
- **Categories ordered by this device's usage.** A cashier hits `suppliers` forty times a day
  and `sponsoring` twice a year; alphabetical order costs a scroll on nearly every entry. See
  [`src/lib/recent.ts`](src/lib/recent.ts).
- **Categories filtered by transaction type.** The backend enforces a category↔type rule
  (an `INCOME`-only category rejects an `EXPENSE` with a 400). Filtering client-side makes that
  error unreachable rather than merely handled.
- **Sensible defaults**: date = today, payment method = whatever was used last (usually CASH).
- **The form resets in place after saving** instead of navigating away — logging a day's till
  is twenty entries in a row, and a detour to a detail screen after each would double the taps.
- **Optional fields are folded away** behind "More details", with a badge so a collapsed
  section never hides a value that is already set.
- **Telegram's native MainButton** is bound to submit, and the in-page save bar renders **only
  when there is no native one** — a browser tab, or a client too old to have it. Rendering both
  put two Save buttons on the same screen, which read as two different actions.

## Two backend details worth knowing

**Money is a string, and not consistently padded.** `transactions.amount` comes back from
`Decimal.toString()`, so 50.00 arrives as `"50"` and 250.50 as `"250.5"` — while the reports
endpoints use `.toFixed(2)` and always pad. Everything renders through `formatAmount()`, which
normalises both. User ids are strings too (`users.id` is a BIGINT); never coerce one to a
number.

**Dates are pinned to the client's day.** `transaction_date` is a SQL `DATE`, and the backend
computes report boundaries in UTC from the _server_ clock. Without intervention, a user in
Tunisia (UTC+1) logging at 00:30 would see yesterday's totals above a form filing under today's
date. The dashboard therefore always sends `?on=<local today>` to `/api/reports/summary`. See
the notes in [`src/lib/format.ts`](src/lib/format.ts).

## Invoice scanning

Photograph an invoice, check what was read off it, save. The flow:

```
/invoices/scan → upload → /invoices/:id/review (polls while OCR runs)
                                    ↓
                        you check every field, edit anything
                                    ↓
                              Save → transaction created
```

Four decisions worth knowing about:

**The camera is in-app, not a file picker.** `/invoices/scan` opens a real `getUserMedia` stream
([`CameraSheet`](src/features/invoices/CameraSheet.tsx)) with a confirm-or-retake step, and only
falls back to `<input type="file">` when a stream is impossible — an insecure origin, an iframe
without camera permission, a refused prompt. The screen used to rely on
`<input type="file" capture="environment">` alone, and that is why "take a photo" reached the
gallery instead: `capture` is a _hint_, and Telegram's Android webview commonly ignores it and
opens the document picker. A narrow `accept` list made it worse, so the inputs now accept
`image/*`. The confirm step is not ceremony either — a blurred page comes back as a draft with
missing fields, which is far more expensive to discover after the upload.

**The photo is uploaded at full resolution.** Every other image path in this app compresses hard;
this one deliberately does not. Tesseract's accuracy falls off sharply below roughly 1000 px on the
long edge, so shrinking the one image the scanner exists to read would defeat the feature. The
ceiling is the backend's 10 MB, and the only images that get re-encoded are the ones that would
otherwise be refused outright — an iOS HEIC, or a frame over that ceiling — which
`transcodeToJpeg` in [`src/lib/image.ts`](src/lib/image.ts) caps at 2600 px rather than at the
1400 px the expense form used.

**The review screen shows the raw text beside every value.** `458.15` is rendered next to
`Net a payer : 458,150`. This is not decoration: the backend's amount parser has to resolve a real
ambiguity — a comma with three trailing digits is either millimes or thousands grouping, and the two
readings differ by 1000×. Showing the source is what lets a user catch that in one glance. **Do not
remove it.**

**Nothing is saved until you press Save.** An unverified draft is never a transaction; it lives in
`invoices.ocr_extracted_data` on the server. So the cash position on the dashboard never includes a
number nobody has checked, and the queue banner says how many invoices are still waiting.

A failed read is still reviewable — the form renders empty and you fill it by hand, which is also
what happens when `OCR_ENABLED=false` on the backend.

Invoice files sit behind the auth middleware, so an `<img src>` pointing at them would 401.
`fetchObjectUrl` in [`src/lib/api.ts`](src/lib/api.ts) fetches the bytes with credentials and hands
back an object URL; `InvoiceImage` owns revoking it.

### The old local-only queue

Before this existed, the expense form captured a photo and parked it in `localStorage`, with a
warning on every surface saying it had never been uploaded. Those warnings are gone, and the capture
moved to the scanner — the OCR flow runs the other way round, creating the expense _from_ the
invoice rather than alongside it.

Attachments still sitting on a device are not abandoned: `/invoices` shows a notice offering to
upload them, and `flushPending()` in [`src/lib/invoiceStore.ts`](src/lib/invoiceStore.ts) does it.
It **links** each image to the transaction it was originally captured against rather than confirming
it as a new draft — confirming would book every one of those expenses a second time. Once a device's
queue is empty that module can be deleted.

## Smoke test

`npm run smoke` loads the **built** bundle in jsdom against a live backend on `localhost:3000`.
Chrome and Edge will not launch in this environment, so this is the closest available thing to
driving the real app: it executes the production bundle, which catches what `tsc` cannot — a bad
import, a hook that throws on first render, a crash reading a field that is null in practice.

Two scripts, runnable on their own:

| Script                       | What it drives                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/smoke-invoices.mjs` | The invoice screens, including the in-app camera: the stream opens, the shutter grabs a frame, accepting it hands a JPEG to the uploader.              |
| `scripts/smoke-entry.mjs`    | `/add/expense` in both hosts — a browser tab, where the page must render the only Save button, and a faked Telegram client, where it must render none. |

Each fakes only the browser: no `mediaDevices` and no canvas exist in jsdom, and a valid Telegram
`initData` signature cannot be minted outside Telegram, so that credential is swapped for the dev
header. The backend is real, and so is everything above those seams.

Run `npm run build` first; both read from `dist/`.

## Testing inside Telegram

`vite.config.ts` sets `host: true`, so the dev server is reachable on the LAN and through a
tunnel:

```bash
npm run dev
npx cloudflared tunnel --url http://localhost:5173     # or: ngrok http 5173
```

Then, via [@BotFather](https://t.me/BotFather): `/newapp` (or `/myapps` → Edit Web App URL) and
point it at the HTTPS tunnel URL. Telegram requires HTTPS — a raw `http://localhost` will not
load. The backend needs the tunnel origin in its `CORS_ORIGINS`, and the same URL in
`MINI_APP_URL` so the bot's "Open app" buttons work.

The bot deep-links into specific screens by **path** (`/add/expense`, `/transactions/42`).
Telegram appends its own `#tgWebAppData=…` fragment, which the history router ignores. Whatever
serves the built frontend must fall back to `index.html` for unknown paths — standard SPA
hosting, and what the Vite dev server already does.

## Project structure

```
src/
├── api/            # Query client, cache keys, and every React Query hook
├── components/
│   ├── form/       # Keypad, category grid, date field, entity picker, invoice capture
│   ├── layout/     # Tab bar, screen header
│   └── ui/         # Button, Card, Chip, Sheet, Field, states — plus ui.css
├── features/
│   ├── auth/       # Boot, error, and dev sign-in screens
│   ├── dashboard/
│   ├── entry/      # The add/edit transaction form
│   ├── invoices/   # Scan, review-and-confirm, and the queue screen
│   └── transactions/
├── hooks/          # useAuth, useToast, Telegram buttons, debounce
├── lib/            # api client, telegram wrapper, formatting, amount rules, storage
├── providers/      # Auth + toast context
├── styles/         # tokens.css (design tokens), global.css (reset + primitives)
└── types/api.ts    # DTOs mirroring the backend, one-to-one
```

## Not built

Scoped out, matching the backend's own status:

- **PDF invoices.** Images only (JPEG/PNG/WebP) — the OCR engine reads pixels, so a PDF is
  refused at upload with a message telling the user to photograph it instead.
- **Invoice line items.** Only the five header fields are extracted (supplier, date, total,
  currency, invoice number). Per-line products, quantities, prices and VAT are the natural next
  step; `ocr_extracted_data` is JSONB and versioned for exactly that.
- **CRUD screens** for suppliers / products / packaging. The app _reads_ all three for the
  expense pickers; the API accepts writes from anyone, but there is no UI for them yet.
- **Category management.** Same: the endpoints are open, the screens do not exist.
- **Reports beyond the dashboard.** `/api/reports/by-category` is wired up as a hook
  (`useByCategory`) but has no screen — a spending-breakdown view is the natural next addition.
- **Deep-link handling beyond routes.** The bot links to `/add/expense` and friends, which the
  router already handles. Prefilling a form from a link (e.g. an amount in the URL) is not wired.
