/**
 * Smoke test for the entry form's submit affordance, run in jsdom against the built bundle.
 *
 * The regression it guards: the form drove Telegram's native MainButton *and* rendered its own
 * save bar, so inside Telegram there were two Save buttons on screen — the client's at the very
 * bottom and the page's just above the tab bar. Exactly one must be reachable in either host.
 *
 * `lib/telegram.ts` reads `window.Telegram` once at module load, so the two hosts cannot be
 * tested in one page: each gets its own JSDOM and its own evaluation of the bundle.
 *
 * Talks to a **live backend** on localhost:3000 for categories and the user, so start the API
 * first.
 *
 *
 * **Pass a throwaway id, never a real one.** The dev sign-in path this harness uses posts to
 * `POST /api/users/login`, which upserts `first_name` — so running it as a real Telegram user
 * renames that user to "Smoke". The default `111` exists for this; `scripts/seed.mjs` deletes it
 * again as a non-Telegram account.
 * Usage:  node scripts/smoke-entry.mjs [telegramId]
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const devId = process.argv[2] ?? '111';
const API = 'http://localhost:3000';

const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

const assets = readdirSync(path.join(distDir, 'assets'));
const jsAsset = assets.find((f) => f.endsWith('.js'));
if (!jsAsset) {
  console.error('No JS bundle in dist/assets — run `npm run build` first.');
  process.exit(1);
}
const bundle = readFileSync(path.join(distDir, 'assets', jsAsset), 'utf8');
const html = readFileSync(path.join(distDir, 'index.html'), 'utf8').replace(
  /<script[^>]*><\/script>/g,
  '',
);

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Boot the bundle on `/add/expense`.
 *
 * `telegram` is the fake `window.Telegram.WebApp`, or null for a plain browser tab.
 */
function boot({ telegram }) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (/Could not parse CSS/.test(err.message)) return;
    console.log(`  note page error: ${err.message}`);
  });

  const dom = new JSDOM(html, {
    url: 'http://localhost:5173/add/expense',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;

  window.localStorage.setItem('xpand:dev-telegram-id', devId);
  window.localStorage.setItem('xpand:dev-first-name', 'Smoke');

  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = { ...(init.headers ?? {}) };

    // Only Telegram can mint a valid `initData` signature, so the one thing this harness fakes
    // is the credential: a `tma` request is forwarded as the dev header instead. The backend,
    // and every other request, stays real.
    if (typeof headers.Authorization === 'string' && headers.Authorization.startsWith('tma ')) {
      delete headers.Authorization;
      headers['x-telegram-id'] = devId;
    }

    return fetch(url.startsWith('http') ? url : `${API}${url}`, { ...init, headers });
  };

  window.Blob = Blob;
  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};
  window.Element.prototype.scrollTo = () => {};
  window.scrollTo = () => {};

  if (telegram) window.Telegram = { WebApp: telegram };

  window.eval(bundle);
  return window;
}

/** A fake Telegram client that records what the app does to its MainButton. */
function fakeTelegram() {
  const mainButtonParams = [];
  const noop = () => {};

  return {
    recorded: mainButtonParams,
    webApp: {
      // Non-empty: this is how `lib/telegram.ts` tells Telegram from a browser tab.
      initData: 'user=%7B%22id%22%3A111%7D&auth_date=1&hash=stub',
      initDataUnsafe: { user: { id: Number(devId), first_name: 'Smoke' }, auth_date: 1 },
      version: '7.10',
      platform: 'android',
      colorScheme: 'light',
      themeParams: { bg_color: '#ffffff', text_color: '#000000' },
      isExpanded: true,
      viewportHeight: 720,
      viewportStableHeight: 720,
      ready: noop,
      expand: noop,
      close: noop,
      isVersionAtLeast: () => true,
      disableVerticalSwipes: noop,
      onEvent: noop,
      offEvent: noop,
      HapticFeedback: {
        impactOccurred: noop,
        notificationOccurred: noop,
        selectionChanged: noop,
      },
      BackButton: { isVisible: false, show: noop, hide: noop, onClick: noop, offClick: noop },
      MainButton: {
        text: '',
        isVisible: false,
        isActive: false,
        isProgressVisible: false,
        show: noop,
        hide: noop,
        enable: noop,
        disable: noop,
        showProgress: noop,
        hideProgress: noop,
        setText: noop,
        setParams: (params) => mainButtonParams.push(params),
        onClick: noop,
        offClick: noop,
      },
    },
  };
}

/** Every rendered button whose label starts with "Save". */
function saveButtons(window) {
  return [...window.document.querySelectorAll('button')].filter((el) =>
    /^Save\b/i.test((el.textContent ?? '').trim()),
  );
}

// --- In a browser tab: the page must provide the only save button ----------------------------

console.log('\n/add/expense in a browser tab (no Telegram host)');
const browser = boot({ telegram: null });
await settle(2500);

check(
  'the form rendered',
  /Add expense/i.test(browser.document.body.textContent ?? ''),
  (browser.document.body.textContent ?? '').slice(0, 140),
);
check(
  'exactly one Save button',
  saveButtons(browser).length === 1,
  `${saveButtons(browser).length}`,
);
check(
  'it is the in-page save bar',
  Boolean(browser.document.querySelector('.entry-form__submit-bar')),
);
check(
  'the form reserves room for it',
  browser.document.querySelector('.entry-form')?.className.includes('entry-form--with-submit-bar'),
);
browser.close();

// --- Inside Telegram: the client provides it, and the page must not duplicate it --------------

console.log('\n/add/expense inside Telegram');
const telegram = fakeTelegram();
const inside = boot({ telegram: telegram.webApp });
await settle(2500);

check(
  'the form rendered',
  /Add expense/i.test(inside.document.body.textContent ?? ''),
  (inside.document.body.textContent ?? '').slice(0, 140),
);
check('no in-page Save button', saveButtons(inside).length === 0, `${saveButtons(inside).length}`);
check('no in-page save bar', !inside.document.querySelector('.entry-form__submit-bar'));
check(
  'the dead space under the form is gone',
  !inside.document.querySelector('.entry-form')?.className.includes('entry-form--with-submit-bar'),
);

const last = telegram.recorded.at(-1);
check('the native MainButton was configured', Boolean(last), JSON.stringify(last));
check(
  'it is visible and says Save',
  last?.is_visible === true && /^Save/i.test(last?.text ?? ''),
  JSON.stringify(last),
);
check('it is inactive until the form is valid', last?.is_active === false, JSON.stringify(last));
inside.close();

console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
