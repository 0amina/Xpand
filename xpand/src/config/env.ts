import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Load `.env` into process.env before we read anything. Doing this here — the module
 * that owns configuration — guarantees env is populated no matter which file imports
 * `env` first. In production the vars usually come from the platform, and dotenv simply
 * finds nothing to load, which is fine.
 */
loadDotenv();

/**
 * Comma-separated origins ("a.com,b.com") are normalized into a trimmed, non-empty array.
 * An empty/absent value means "no cross-origin browser clients allowed".
 */
const corsOriginsSchema = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );

/**
 * Treat a blank value as absent.
 *
 * A `.env` file routinely carries `TELEGRAM_BOT_TOKEN=` as a placeholder, and dotenv turns
 * that into the empty string — which is *present* as far as Zod is concerned, so `.optional()`
 * alone would not save it and `.url()` / `.min()` would reject it. Without this, commenting a
 * variable out by emptying it would crash the process at startup.
 */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Whether we are running as a serverless function rather than a long-lived server.
 *
 * Vercel sets `VERCEL=1` in every build and runtime environment. This flag decides three
 * defaults further down that would otherwise each need configuring by hand, and every one of
 * them is a silent failure if it is wrong:
 *
 *  - writable paths move under `/tmp`, the only directory that is not read-only;
 *  - invoice files go to object storage, because `/tmp` does not survive the invocation;
 *  - OCR runs inside the request, because the instance is frozen once a response is sent.
 *
 * Read from `process.env` directly: it is needed to build the schema's defaults, so it cannot
 * come from the parsed output.
 */
export const isServerless = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

/** The only writable location on a serverless host, and ephemeral even there. */
const writableDir = (relative: string): string =>
  isServerless ? `/tmp/${relative.replace(/^\.?\//, '')}` : relative;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // `coerce` lets us accept the string PORT from the environment and get a number out.
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid connection URL' }),

  CORS_ORIGINS: corsOriginsSchema,

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * Bot token from @BotFather. Optional in development (the bot simply stays off and auth
   * falls back to the dev header), but REQUIRED in production — it is the key that validates
   * Mini App initData, so without it there is no way to authenticate anyone. See the
   * production guard in `parseEnv` below.
   */
  TELEGRAM_BOT_TOKEN: z.preprocess(blankToUndefined, z.string().min(1).optional()),

  /**
   * How the bot receives updates.
   *  - `polling`  — the bot asks Telegram for updates. No public URL needed; right for local dev.
   *  - `webhook`  — Telegram POSTs to us. Needs BOT_WEBHOOK_URL; right for production.
   *  - `off`      — no bot at all.
   * Defaults to `polling` when a token is present and `off` when it isn't.
   */
  BOT_MODE: z.preprocess(blankToUndefined, z.enum(['polling', 'webhook', 'off']).optional()),

  /** Public HTTPS base URL of THIS backend, for webhook mode. e.g. https://api.example.com */
  BOT_WEBHOOK_URL: z.preprocess(blankToUndefined, z.string().url().optional()),

  /**
   * Shared secret echoed by Telegram in `X-Telegram-Bot-Api-Secret-Token`. Without it, anyone
   * who guesses the webhook path can inject fake updates. Generated automatically if unset.
   */
  BOT_WEBHOOK_SECRET: z.preprocess(blankToUndefined, z.string().min(16).optional()),

  /**
   * Public HTTPS URL of the Mini App frontend. Used to build `web_app` buttons — Telegram
   * rejects non-HTTPS URLs, so without this the bot answers with text only and no app buttons.
   */
  MINI_APP_URL: z.preprocess(blankToUndefined, z.string().url().optional()),

  // Starting cash balance for the "cash position" report. The database has no column for
  // this, so it's configured here (default 0). Requests may override it per-call.
  OPENING_BALANCE: z.coerce.number().finite().default(0),

  // --- Invoices & OCR -----------------------------------------------------------------

  /**
   * Where uploaded invoice files are written. Relative paths resolve against the process CWD.
   * The directory is created on first upload. Nothing else in the app reads it — files are
   * always served through `GET /api/invoices/:id/file`, never as static assets, so that the
   * auth middleware sits in front of them.
   */
  UPLOAD_DIR: z.string().min(1).default(writableDir('./uploads/invoices')),

  /**
   * Which storage backend holds invoice files: `disk` or `supabase`.
   *
   * Defaults to `supabase` when a `SUPABASE_URL` is configured and `disk` otherwise, which makes
   * local development need no setting at all and production need no extra one. Set it explicitly
   * to pin the choice — notably `STORAGE_DRIVER=disk` with Supabase credentials present, if you
   * want local files while still talking to the hosted database.
   */
  STORAGE_DRIVER: z.preprocess(blankToUndefined, z.enum(['disk', 'supabase']).optional()),

  /** Supabase project URL, e.g. https://abcdefgh.supabase.co. Required by the supabase driver. */
  SUPABASE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),

  /**
   * Supabase `service_role` key. **Bypasses row-level security by design** — it is the server's
   * key and must never reach the browser. It is only ever read by `invoices/storage.ts`.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(blankToUndefined, z.string().min(20).optional()),

  /** Storage bucket for invoice files. Must be created **private**; see the README. */
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('invoices'),

  /** Hard ceiling on a single invoice upload. Phone photos are typically 2-6 MB. */
  MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(10),

  /**
   * Tesseract languages, `+`-joined. Defaults to French then English: invoices here are
   * overwhelmingly French (so are the seeded category names), and English catches the
   * occasional bilingual header. Each language adds to worker warm-up time.
   */
  OCR_LANGS: z.string().min(1).default('fra+eng'),

  /**
   * Where Tesseract caches its `*.traineddata`. Without this it writes multi-megabyte blobs
   * into the process CWD — i.e. the repo root. First OCR needs network access to fetch them;
   * afterwards it runs fully offline.
   */
  TESSDATA_DIR: z.string().min(1).default(writableDir('./.tessdata')),

  /**
   * Whether OCR runs *inside* the upload request instead of after the response.
   *
   * Fire-and-forget is the better shape on a long-lived server: the upload returns in
   * milliseconds and the client polls for `status`. On a serverless host it does not work at all
   * — the instance is frozen as soon as the response is written, so the pipeline would be killed
   * mid-read and every invoice would sit in PENDING for ever.
   *
   * Defaults to on when serverless, off otherwise. The trade-off is a slow upload (OCR takes a
   * few seconds per page) in exchange for a response that already carries the finished draft.
   */
  OCR_SYNC: z.preprocess(
    // Same `.default()`-inside-preprocess placement as OCR_ENABLED below, for the same reason.
    (v) => (typeof v === 'string' ? !/^(false|0|no|off)$/i.test(v.trim()) : v),
    z.boolean().default(isServerless),
  ),

  /**
   * Turn OCR off while still accepting uploads. Invoices then land in `FAILED` with an
   * explanatory message and the user fills the draft by hand — the verify-then-save flow is
   * identical, since OCR only ever pre-fills a form nobody is forced to trust.
   */
  /*
   * Note the `.default(true)` placement: it is *inside* the preprocess, not chained after it.
   * `z.preprocess(fn, schema).default(true)` substitutes the default and then runs it back
   * through `fn`, where a real boolean fails a string comparison and silently becomes `false` —
   * i.e. the opt-out default would disable the feature it was meant to enable.
   */
  OCR_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? !/^(false|0|no|off)$/i.test(v.trim()) : v),
    z.boolean().default(true),
  ),
});

/** The validated, strongly-typed shape of our environment. */
export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // Fail fast with a human-readable summary rather than a stack trace deep in the app.
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // eslint-disable-next-line no-console -- the logger depends on env; it isn't available yet.
    console.error(`\n✖ Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }

  const parsed = result.data;

  /*
   * Production guard.
   *
   * In production the ONLY way to authenticate is a Mini App initData signature, and that
   * signature is verified with the bot token. Booting without it would leave the app either
   * completely unusable or — worse, if the dev header path were reachable — wide open. Fail
   * loudly at startup rather than at the first request.
   */
  if (parsed.NODE_ENV === 'production' && !parsed.TELEGRAM_BOT_TOKEN) {
    // eslint-disable-next-line no-console -- the logger depends on env; it isn't available yet.
    console.error(
      '\n✖ TELEGRAM_BOT_TOKEN is required when NODE_ENV=production.\n' +
        '  It verifies Mini App initData signatures — without it nobody can authenticate.\n',
    );
    process.exit(1);
  }

  if (parsed.BOT_MODE === 'webhook' && !parsed.BOT_WEBHOOK_URL) {
    // eslint-disable-next-line no-console -- same reason.
    console.error('\n✖ BOT_MODE=webhook requires BOT_WEBHOOK_URL to be set.\n');
    process.exit(1);
  }

  /*
   * Storage guard.
   *
   * Asking for the Supabase driver without credentials would fail at the first upload, with the
   * user's photo already buffered and nowhere to put it. Catch it at boot instead.
   */
  const wantsSupabase =
    parsed.STORAGE_DRIVER === 'supabase' ||
    (parsed.STORAGE_DRIVER === undefined && Boolean(parsed.SUPABASE_URL));

  if (wantsSupabase && !(parsed.SUPABASE_URL && parsed.SUPABASE_SERVICE_ROLE_KEY)) {
    // eslint-disable-next-line no-console -- same reason.
    console.error(
      '\n✖ The supabase storage driver needs both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n' +
        '  Set STORAGE_DRIVER=disk to store invoice files on the local filesystem instead.\n',
    );
    process.exit(1);
  }

  /*
   * The disk driver cannot work on a serverless host: the filesystem is read-only apart from
   * `/tmp`, and `/tmp` is gone by the time the user opens the review screen. Uploads would
   * appear to succeed and then 404, which is far worse than refusing to start.
   */
  if (isServerless && !wantsSupabase) {
    // eslint-disable-next-line no-console -- same reason.
    console.error(
      '\n✖ Invoice files cannot be stored on disk on a serverless host — the filesystem does not\n' +
        '  persist between invocations. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n',
    );
    process.exit(1);
  }

  return parsed;
}

/** Frozen, validated environment. Import this everywhere instead of touching process.env. */
export const env: Env = Object.freeze(parseEnv());

/**
 * Whether the bot should run, resolved from BOT_MODE and the presence of a token. A token with
 * no explicit mode means "poll" — the useful default for local development.
 */
export const botMode: 'polling' | 'webhook' | 'off' = !env.TELEGRAM_BOT_TOKEN
  ? 'off'
  : (env.BOT_MODE ?? (isServerless ? 'webhook' : 'polling'));

/**
 * Which invoice storage backend is live. Resolved once here so `storage.ts` picks its backend at
 * module load and never re-decides per call. See STORAGE_DRIVER above for the defaulting rule.
 */
export const storageDriver: 'disk' | 'supabase' =
  env.STORAGE_DRIVER ?? (env.SUPABASE_URL ? 'supabase' : 'disk');

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
