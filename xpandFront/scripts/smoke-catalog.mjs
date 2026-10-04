/**
 * Smoke test for the supplier and product screens, run in jsdom against the built bundle.
 *
 * This one **writes to the live database**: it adds a record through the UI, edits it, selects it
 * on the expense form, then deletes it through the UI. Every row it creates is named with the
 * prefix below and removed again at the end, including on failure — nothing here is mocked except
 * the browser, so a half-run would otherwise leave litter in the catalog.
 *
 *
 * **Pass a throwaway id, never a real one.** The dev sign-in path this harness uses posts to
 * `POST /api/users/login`, which upserts `first_name` — so running it as a real Telegram user
 * renames that user to "Smoke". The default `111` exists for this; `scripts/seed.mjs` deletes it
 * again as a non-Telegram account.
 * Usage:  node scripts/smoke-catalog.mjs [telegramId]
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const devId = process.argv[2] ?? '111';
const API = 'http://localhost:3000';

/** Everything this script creates starts with this, so cleanup can find it. */
const PREFIX = 'Smoke Test';

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

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (err) => {
  if (/Could not parse CSS/.test(err.message)) return;
  console.log(`  note page error: ${err.message}`);
});

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/suppliers',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;

window.localStorage.setItem('xpand:dev-telegram-id', devId);
window.localStorage.setItem('xpand:dev-first-name', 'Smoke');

window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  return fetch(url.startsWith('http') ? url : `${API}${url}`, init);
};
window.Blob = Blob;
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};
window.Element.prototype.scrollTo = () => {};
window.scrollTo = () => {};
// jsdom's `confirm` throws "not implemented"; the delete flow goes through it outside Telegram.
window.confirm = () => true;

// --- Driving helpers ---------------------------------------------------------------------------

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = () => window.document.body.textContent ?? '';

/** Every element matching `selector` whose text matches `pattern`. */
const allByText = (selector, pattern) =>
  [...window.document.querySelectorAll(selector)].filter((el) =>
    pattern.test(el.textContent ?? ''),
  );
const byText = (selector, pattern) => allByText(selector, pattern)[0];

/**
 * Set a controlled input's value the way a user would.
 *
 * React tracks the DOM node's value internally, so assigning `el.value` and dispatching an event
 * is ignored as a no-op change. Going through the prototype's setter is what makes React see it.
 */
function type(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** Navigate the way the router does, without a page load. */
async function go(pathname, wait = 900) {
  window.history.pushState({}, '', pathname);
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await settle(wait);
}

/** Field inputs are rendered in order, so index them off their labels' order on the form. */
const inputs = () => [...window.document.querySelectorAll('.entry-form input')];

/** Remove anything this script created, whatever happened. Uses the API directly. */
async function cleanup() {
  for (const resource of ['suppliers', 'products']) {
    const response = await fetch(`${API}/api/${resource}?search=${encodeURIComponent(PREFIX)}`, {
      headers: { 'x-telegram-id': devId },
    });
    if (!response.ok) continue;
    const { data } = await response.json();
    for (const row of data ?? []) {
      await fetch(`${API}/api/${resource}/${row.id}`, {
        method: 'DELETE',
        headers: { 'x-telegram-id': devId },
      });
    }
  }
}

// Start from a clean slate in case an earlier run died mid-way.
await cleanup();

console.log(`\nLoading bundle ${jsAsset} in jsdom…`);
window.eval(bundle);

try {
  await settle(2500);

  // --- Suppliers: list, add, edit, delete -----------------------------------------------------

  console.log('\n/suppliers — the list');
  check('rendered the suppliers screen', /Suppliers/i.test(text()), text().slice(0, 140));
  check(
    'offers a way to add one',
    Boolean(byText('a', /^\+ New$/)) || /Add supplier/i.test(text()),
  );

  console.log('\n/suppliers/new — add');
  await go('/suppliers/new');
  check('rendered the new-supplier form', /New supplier/i.test(text()), text().slice(0, 140));
  check('has a name field and the optional ones', inputs().length >= 4, `${inputs().length}`);

  const saveDisabled = byText('button', /^Add supplier$/)?.disabled;
  check('Save is disabled until a name is typed', saveDisabled === true, String(saveDisabled));

  type(inputs()[0], `${PREFIX} Supplier`);
  type(inputs()[2], '+216 71 123 456');
  await settle(150);

  // An invalid email must block the save locally rather than relying on the API's 400.
  type(inputs()[3], 'not-an-email');
  await settle(150);
  check(
    'a malformed email is caught before saving',
    /does not look like an email/i.test(text()) && byText('button', /^Add supplier$/)?.disabled,
  );

  type(inputs()[3], 'smoke@example.com');
  await settle(150);
  check('a valid email clears the error', !/does not look like an email/i.test(text()));

  byText('button', /^Add supplier$/)?.click();
  await settle(1500);

  check('saving returned to the list', /Suppliers/i.test(text()) && !/New supplier/i.test(text()));
  check('the new supplier is listed', text().includes(`${PREFIX} Supplier`), text().slice(0, 240));
  check('its phone shows as the subtitle', /\+216 71 123 456/.test(text()));

  console.log('\n/suppliers/:id — edit');
  byText('button.list-row', new RegExp(PREFIX))?.click();
  await settle(1200);
  check('rendered the edit form', /Edit supplier/i.test(text()), text().slice(0, 140));
  check(
    'prefilled the saved name',
    inputs()[0]?.value === `${PREFIX} Supplier`,
    inputs()[0]?.value,
  );
  check('prefilled the saved phone', inputs()[2]?.value === '+216 71 123 456', inputs()[2]?.value);

  // Rename, and clear the phone — the clear is the case that needs an explicit null on the wire.
  type(inputs()[0], `${PREFIX} Supplier Renamed`);
  type(inputs()[2], '');
  await settle(150);
  byText('button', /^Save changes$/)?.click();
  await settle(1500);

  check('the rename is in the list', text().includes(`${PREFIX} Supplier Renamed`));
  check('the cleared phone is gone', !/\+216 71 123 456/.test(text()), text().slice(0, 240));

  const afterEdit = await fetch(
    `${API}/api/suppliers?search=${encodeURIComponent(`${PREFIX} Supplier`)}`,
    { headers: { 'x-telegram-id': devId } },
  ).then((r) => r.json());
  check(
    'the server stored the cleared phone as null',
    afterEdit.data?.[0]?.phone === null,
    JSON.stringify(afterEdit.data?.[0]?.phone),
  );
  check('the email survived the edit', afterEdit.data?.[0]?.email === 'smoke@example.com');

  // --- The picker on the expense form ---------------------------------------------------------

  console.log('\n/add/expense — the supplier is selectable, and one can be added inline');
  await go('/add/expense', 1500);
  byText('button', /More details/i)?.click();
  await settle(400);

  const triggers = [...window.document.querySelectorAll('button.picker-trigger')];
  check('the three pickers are on the form', triggers.length === 3, `${triggers.length}`);

  triggers[0]?.click();
  await settle(900);
  check('the supplier sheet opened', Boolean(window.document.querySelector('.sheet')));
  check('it links to the management screen', /Manage suppliers/i.test(text()));

  const sheetSearch = window.document.querySelector('.picker-search input');
  type(sheetSearch, `${PREFIX} Supplier Renamed`);
  await settle(1200); // debounce + fetch

  const existingOption = byText('button.picker-option', new RegExp(`${PREFIX} Supplier Renamed`));
  check('the saved supplier is offered', Boolean(existingOption), text().slice(-200));
  existingOption?.click();
  await settle(500);
  check(
    'selecting it shows on the trigger',
    window.document
      .querySelectorAll('button.picker-trigger')[0]
      ?.textContent?.includes(`${PREFIX} Supplier Renamed`),
    window.document.querySelectorAll('button.picker-trigger')[0]?.textContent ?? '',
  );

  // Now the inline create: a name the catalog does not have.
  window.document.querySelectorAll('button.picker-trigger')[0]?.click();
  await settle(700);
  type(window.document.querySelector('.picker-search input'), `${PREFIX} Inline`);
  await settle(1200);

  // Matches both shapes of the affordance: the row under a list of near-misses, and the empty
  // state's button when nothing matched at all.
  const createOption = byText('button', /Add\s*[“"]/);
  check('an unknown name can be added from the picker', Boolean(createOption), text().slice(-220));
  createOption?.click();
  await settle(1500);

  check(
    'the new supplier is selected on the form',
    window.document
      .querySelectorAll('button.picker-trigger')[0]
      ?.textContent?.includes(`${PREFIX} Inline`),
    window.document.querySelectorAll('button.picker-trigger')[0]?.textContent ?? '',
  );

  const inline = await fetch(
    `${API}/api/suppliers?search=${encodeURIComponent(`${PREFIX} Inline`)}`,
    { headers: { 'x-telegram-id': devId } },
  ).then((r) => r.json());
  check('it was really created server-side', (inline.data ?? []).length === 1);

  // --- Products: add, edit, delete ------------------------------------------------------------

  console.log('\n/products — add, edit, delete');
  await go('/products/new', 1200);
  check('rendered the new-product form', /New product/i.test(text()), text().slice(0, 140));

  type(inputs()[0], `${PREFIX} Product`);
  type(inputs()[1], 'SMOKE-1');
  type(inputs()[2], '12,50'); // Comma separator, as a Tunisian keyboard offers.
  await settle(150);
  check('a comma price is accepted', !/at most two decimals/i.test(text()));

  type(inputs()[2], '12.555');
  await settle(150);
  check('three decimals are refused locally', /at most two decimals/i.test(text()));

  type(inputs()[2], '12,50');
  await settle(150);
  byText('button', /^Add product$/)?.click();
  await settle(1500);

  check('the product is listed', text().includes(`${PREFIX} Product`), text().slice(0, 240));
  check('the SKU shows as the subtitle', /SKU SMOKE-1/.test(text()));
  check('the price shows on the row', /12\.50/.test(text()), text().slice(0, 240));

  const storedProduct = await fetch(
    `${API}/api/products?search=${encodeURIComponent(`${PREFIX} Product`)}`,
    { headers: { 'x-telegram-id': devId } },
  ).then((r) => r.json());
  check(
    'the comma was sent as a dot decimal',
    storedProduct.data?.[0]?.unitPrice === '12.50',
    String(storedProduct.data?.[0]?.unitPrice),
  );

  byText('button.list-row', new RegExp(PREFIX))?.click();
  await settle(1200);
  check('rendered the product edit form', /Edit product/i.test(text()));
  check('prefilled the price without padding', inputs()[2]?.value === '12.5', inputs()[2]?.value);

  byText('button', /^Delete product$/)?.click();
  await settle(1500);
  check('the product is gone from the list', !text().includes(`${PREFIX} Product`));

  const afterProductDelete = await fetch(
    `${API}/api/products?search=${encodeURIComponent(PREFIX)}`,
    { headers: { 'x-telegram-id': devId } },
  ).then((r) => r.json());
  check('the server deleted it', (afterProductDelete.data ?? []).length === 0);

  // --- Delete the suppliers through the UI too ------------------------------------------------

  console.log('\n/suppliers — delete');
  await go('/suppliers', 1300);
  byText('button.list-row', new RegExp(`${PREFIX} Inline`))?.click();
  await settle(1200);
  byText('button', /^Delete supplier$/)?.click();
  await settle(1500);
  check('the inline-created supplier is gone', !text().includes(`${PREFIX} Inline`));

  byText('button.list-row', new RegExp(`${PREFIX} Supplier Renamed`))?.click();
  await settle(1200);
  byText('button', /^Delete supplier$/)?.click();
  await settle(1500);
  check(
    'the edited supplier is gone',
    !text().includes(`${PREFIX} Supplier`),
    text().slice(0, 240),
  );

  const afterSupplierDelete = await fetch(
    `${API}/api/suppliers?search=${encodeURIComponent(PREFIX)}`,
    { headers: { 'x-telegram-id': devId } },
  ).then((r) => r.json());
  check('the server deleted them', (afterSupplierDelete.data ?? []).length === 0);
} finally {
  await cleanup();
}

console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
dom.window.close();
process.exit(failures.length === 0 ? 0 : 1);
