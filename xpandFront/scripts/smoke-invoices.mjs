/**
 * Smoke test for the invoice flow, run in jsdom against the built bundle.
 *
 * Why this shape: Chrome and Edge will not launch in this environment, so there is no headless
 * browser to drive. jsdom loading `dist/` is the next best thing — it executes the real bundle, so
 * it catches what a typecheck cannot: a bad import, a hook that throws on first render, a crash
 * reading a field that is null in practice.
 *
 * It talks to a **live backend** on localhost:3000 and uses the `x-telegram-id` dev credential, so
 * start the API first. Nothing here is mocked except the browser itself.
 *
 *
 * **Pass a throwaway id, never a real one.** The dev sign-in path this harness uses posts to
 * `POST /api/users/login`, which upserts `first_name` — so running it as a real Telegram user
 * renames that user to "Smoke". The default `111` exists for this; `scripts/seed.mjs` deletes it
 * again as a non-Telegram account.
 * Usage:  node scripts/smoke-invoices.mjs [telegramId]
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
const notes = [];

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

// --- Load the built bundle -------------------------------------------------------------------

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

// Surface real page errors; swallow jsdom's CSS-parser complaints, which are noise here.
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (err) => {
  if (/Could not parse CSS/.test(err.message)) return;
  notes.push(`page error: ${err.message}`);
});
virtualConsole.on('error', (msg) => notes.push(`console.error: ${msg}`));

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/invoices',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
});

const { window } = dom;

// The dev-credential keys the AuthProvider reads. `lib/storage.ts` namespaces everything under
// `xpand:`, so the prefix is required or the app lands on the sign-in screen instead.
window.localStorage.setItem('xpand:dev-telegram-id', devId);
window.localStorage.setItem('xpand:dev-first-name', 'Smoke');

// jsdom has no fetch; forward to Node's, rewriting relative URLs to the API origin.
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  return fetch(url.startsWith('http') ? url : `${API}${url}`, init);
};
window.Blob = Blob;
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};

// jsdom implements no scrolling, so `Element.scrollTo` is undefined. App.tsx calls it on every
// route change to reset scroll position; without this the call throws inside the effect and React
// unmounts the whole tree, which looks exactly like a blank page.
window.Element.prototype.scrollTo = () => {};
window.scrollTo = () => {};

/**
 * The last multipart upload the bundle attempted.
 *
 * Captured rather than forwarded: the camera section below shoots a stub frame, and posting it
 * for real would leave an unreadable invoice sitting in the live queue for someone to clear.
 */
let lastUpload = null;

/** Minimal XHR so `api.upload` can run; the bundle uses it for upload progress. */
class StubXHR {
  constructor() {
    this.upload = { addEventListener: () => {} };
    this.status = 0;
    this.responseText = '';
    this._listeners = {};
  }
  open(method, url) {
    this._method = method;
    this._url = url;
  }
  setRequestHeader(name, value) {
    this._headers = { ...this._headers, [name]: value };
  }
  addEventListener(type, fn) {
    this._listeners[type] = fn;
  }
  send(body) {
    // Invoice uploads are answered locally; everything else still hits the real API.
    if (this._method === 'POST' && /\/api\/invoices$/.test(this._url)) {
      lastUpload = { file: body?.get?.('file') ?? null };
      this.status = 201;
      this.responseText = JSON.stringify({
        data: { id: 999999, status: 'PENDING', draft: null },
      });
      setTimeout(() => this._listeners.load?.(), 0);
      return;
    }

    fetch(this._url, { method: this._method, headers: this._headers, body })
      .then(async (res) => {
        this.status = res.status;
        this.responseText = await res.text();
        this._listeners.load?.();
      })
      .catch(() => this._listeners.error?.());
  }
}
window.XMLHttpRequest = StubXHR;

// --- Camera stubs -----------------------------------------------------------------------------
// jsdom has neither `mediaDevices` nor a canvas, so the in-app scanner's two hard dependencies
// are faked at the narrowest possible point: a stream that yields one stoppable track, and a 2D
// context that swallows the draw. Everything above them — the phase machine, the frame grab, the
// confirm step, the handoff to the uploader — is the real bundle.

const stoppedTracks = [];
Object.defineProperty(window.navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getUserMedia: async () => ({
      getTracks: () => [{ kind: 'video', stop: () => stoppedTracks.push(1) }],
    }),
  },
});

window.HTMLVideoElement.prototype.play = async () => {};
for (const [prop, value] of [
  ['videoWidth', 1536],
  ['videoHeight', 2048],
]) {
  Object.defineProperty(window.HTMLVideoElement.prototype, prop, {
    configurable: true,
    get: () => value,
  });
}

window.HTMLCanvasElement.prototype.getContext = () => ({
  fillStyle: '',
  fillRect: () => {},
  drawImage: () => {},
});
window.HTMLCanvasElement.prototype.toBlob = (callback) =>
  callback(new Blob([new Uint8Array(4096)], { type: 'image/jpeg' }));

console.log(`\nLoading bundle ${jsAsset} in jsdom…`);
window.eval(bundle);

// --- Drive it -------------------------------------------------------------------------------

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = () => window.document.body.textContent ?? '';

await settle(2500);

console.log('\n/invoices — the queue screen');
check(
  'app mounted (root is not empty)',
  (window.document.getElementById('root')?.childElementCount ?? 0) > 0,
);
check('rendered the Invoices screen', /Invoices/i.test(text()), text().slice(0, 120));
check('offers a way to scan', /Scan/i.test(text()));
check(
  'no device-local warning remains',
  !/stored on this device|only on this device|never uploaded/i.test(text()),
);
check('did not render an auth error', !/not signed in|Session not recognised/i.test(text()));

// Navigate client-side, the way the router does.
console.log('\n/invoices/scan — the upload screen');
window.history.pushState({}, '', '/invoices/scan');
window.dispatchEvent(new window.PopStateEvent('popstate'));
await settle(800);
check(
  'rendered the scan screen',
  /Scan an invoice|Take a photo/i.test(text()),
  text().slice(0, 140),
);
check(
  'offers both a camera and the gallery',
  /Take a photo/i.test(text()) && /existing photo/i.test(text()),
);
check('says PDFs are unsupported', /PDF/i.test(text()));

// --- The in-app camera ----------------------------------------------------------------------
// The regression this guards: "Take a photo" used to be a `<input capture=environment>` click,
// which Telegram's Android webview answers with the document picker. It must now open a real
// stream, and the shot must reach the uploader as a JPEG.

console.log('\n/invoices/scan — the camera');
const byText = (selector, pattern) =>
  [...window.document.querySelectorAll(selector)].find((el) => pattern.test(el.textContent ?? ''));

byText('button', /Take a photo/i)?.click();
await settle(400);

check('the camera opened in-app', Boolean(window.document.querySelector('.camera')));
check('a live preview is mounted', Boolean(window.document.querySelector('video.camera__video')));
check(
  'no camera error shown',
  !/could not be opened|was refused/i.test(text()),
  text().slice(-160),
);

const shutter = window.document.querySelector('.camera__shutter');
check('the shutter is enabled once live', Boolean(shutter) && !shutter.disabled);

shutter?.click();
await settle(400);

check('the shot is offered for review', /Use this photo/i.test(text()) && /Retake/i.test(text()));
check('the still is shown', Boolean(window.document.querySelector('img.camera__still')));

byText('button', /Use this photo/i)?.click();
await settle(600);

check('the camera closed after accepting', !window.document.querySelector('.camera'));
check('the camera was released', stoppedTracks.length > 0);
check(
  'a JPEG reached the uploader',
  lastUpload?.file?.type === 'image/jpeg',
  String(lastUpload?.file?.type),
);
check(
  'the upload carries bytes',
  (lastUpload?.file?.size ?? 0) > 0,
  String(lastUpload?.file?.size),
);

console.log('\n/ — the dashboard still renders');
window.history.pushState({}, '', '/');
window.dispatchEvent(new window.PopStateEvent('popstate'));
await settle(1200);
check('dashboard rendered', /Cash position|Income|Expense/i.test(text()), text().slice(0, 140));
check('dashboard offers the scanner', /Scan invoice/i.test(text()));

// --- Report ---------------------------------------------------------------------------------

if (notes.length > 0) {
  console.log('\nPage diagnostics:');
  for (const note of [...new Set(notes)].slice(0, 10)) console.log(`  - ${note}`);
}

console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
dom.window.close();
process.exit(failures.length === 0 ? 0 : 1);
