/**
 * Replace the ledger with a clean, realistic dataset.
 *
 * What it does, in one transaction:
 *   1. keeps the real Telegram users and deletes the rest (dev and test accounts);
 *   2. deletes every invoice, transaction, supplier, product and packaging row;
 *   3. inserts a coherent three-month ledger for a small Tunisian food producer, plus the
 *      supplier / product / packaging catalogue it refers to.
 *
 * It never touches `categories` — those eleven rows are reference data the app depends on — and
 * never touches the schema. `prisma/schema.prisma` is introspected; this script only writes data.
 *
 * Deterministic: the amounts come from a seeded PRNG, so two runs produce the same ledger and a
 * re-run is a reset rather than a second, different dataset.
 *
 * Usage:
 *   node scripts/seed.mjs                 # dry run — prints the plan, writes nothing
 *   node scripts/seed.mjs --yes           # apply it
 *   node scripts/seed.mjs --yes --keep 6442273051,7001234567
 *
 * `--keep` overrides which user ids survive. Without it the rule below decides, and the dry run
 * shows you exactly who is on each list before anything is deleted.
 */
import 'dotenv/config';
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--yes');
const keepArg = process.argv.find((a) => a.startsWith('--keep='))?.slice('--keep='.length);
const KEEP_OVERRIDE = keepArg ? keepArg.split(',').map((s) => BigInt(s.trim())) : null;

/**
 * Is this id a real Telegram account?
 *
 * Telegram user ids are nine or ten digits today and only ever grow. Everything this project
 * used as a stand-in is far below that: `111` is the `x-telegram-id` dev credential the READMEs
 * and smoke tests use, and the `999000xxx` block is leftover fixture data. Ten million is well
 * above both and well below any id Telegram has issued.
 */
const TELEGRAM_ID_FLOOR = 10_000_000n;
const TEST_BLOCK_START = 999_000_000n;
const TEST_BLOCK_END = 999_999_999n;

function isRealTelegramUser(id) {
  if (KEEP_OVERRIDE) return KEEP_OVERRIDE.some((k) => k === id);
  if (id >= TEST_BLOCK_START && id <= TEST_BLOCK_END) return false;
  return id >= TELEGRAM_ID_FLOOR;
}

// --- Deterministic randomness -----------------------------------------------------------------

/** mulberry32 — small, fast, and identical across runs, which is the only property we need. */
function makeRandom(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261004;

/**
 * The live stream, reset at the top of every `buildLedger` call.
 *
 * It has to be reset rather than merely seeded once, because `buildLedger` runs **twice** per
 * invocation: once against placeholder ids to print the plan, and once against the real ids to
 * insert. Sharing one continuing stream meant the second call resumed where the first stopped
 * and generated a different ledger — the dry run promised 209 rows and 192 were written. The dry
 * run is only worth having if it is exactly what lands.
 */
let random = makeRandom(SEED);

/** A money amount in `[min, max]`, rounded to the 2 decimals the column stores. */
function money(min, max) {
  return (min + random() * (max - min)).toFixed(2);
}

/** Pick one element. */
function pick(list) {
  return list[Math.floor(random() * list.length)];
}

/** `true` with probability `p`. */
function chance(p) {
  return random() < p;
}

// --- The dataset ------------------------------------------------------------------------------
//
// A small producer of olive oil and preserved foods: buys olives and oil from growers, bottles
// and labels them, sells over the counter and in bulk to grocers. That shape is what makes the
// eleven seeded categories line up with something real — `suppliers` and `packaging` are its two
// biggest costs, `recettes` its only income, and the product↔packaging links are its bill of
// materials. Names are invented rather than borrowed from real Tunisian firms.

const SUPPLIERS = [
  {
    key: 'huilerie',
    name: 'Huilerie El Baraka',
    contact_person: 'Mohamed Trabelsi',
    phone: '+216 74 221 450',
    email: 'contact@huilerie-elbaraka.tn',
    address: 'Route de Gabès km 4, Sfax 3052',
    notes: 'Main oil supplier. Net-30, invoices by email. Best prices after the November harvest.',
  },
  {
    key: 'comptoir',
    name: 'Comptoir Agricole du Sahel',
    contact_person: 'Leila Ben Salah',
    phone: '+216 73 368 112',
    email: 'commandes@comptoir-sahel.tn',
    address: 'Zone industrielle, Moknine 5050',
    notes: 'Table olives, peppers and spices. Delivers Tuesdays and Fridays.',
  },
  {
    key: 'verrerie',
    name: 'Verrerie du Cap Bon',
    contact_person: 'Hichem Jlassi',
    phone: '+216 72 285 900',
    email: 'ventes@verrerie-capbon.tn',
    address: 'Route de Menzel Temime, Nabeul 8000',
    notes: 'Bottles and jars. Minimum order one pallet; breakage credited on the next invoice.',
  },
  {
    key: 'cartonnerie',
    name: 'Cartonnerie Medjerda',
    contact_person: 'Sonia Gharbi',
    phone: '+216 78 412 335',
    email: 'sonia.gharbi@cartonnerie-medjerda.tn',
    address: 'Avenue de l’Industrie, Béja 9000',
    notes: 'Cartons and pallets. Two weeks lead time on printed cartons.',
  },
  {
    key: 'imprimerie',
    name: 'Imprimerie Zitouna',
    contact_person: 'Karim Mansour',
    phone: '+216 71 604 870',
    email: 'devis@imprimerie-zitouna.tn',
    address: '12 rue de Carthage, Ben Arous 2013',
    notes: 'Adhesive labels. Artwork on file; reorders need no new proof.',
  },
  {
    key: 'transit',
    name: 'Transit Sud Logistique',
    contact_person: 'Anis Khelifi',
    phone: '+216 75 390 240',
    email: 'anis@transitsud.tn',
    address: 'Port de Sfax, quai 3',
    notes: 'Deliveries to Tunis and Sousse. Invoices monthly.',
  },
];

const PRODUCTS = [
  {
    key: 'hoev1',
    name: 'Huile d’olive extra vierge 1 L',
    sku: 'HO-EV-1L',
    unit_price: '18.50',
    description: 'Première pression à froid, récolte de l’année. Bouteille verre 1 L.',
  },
  {
    key: 'hoev5',
    name: 'Huile d’olive extra vierge 5 L',
    sku: 'HO-EV-5L',
    unit_price: '86.00',
    description: 'Bidon 5 L pour la restauration et la vente en gros.',
  },
  {
    key: 'hov1',
    name: 'Huile d’olive vierge 1 L',
    sku: 'HO-V-1L',
    unit_price: '15.00',
    description: 'Deuxième catégorie, usage quotidien.',
  },
  {
    key: 'harissa',
    name: 'Harissa artisanale 350 g',
    sku: 'HAR-350',
    unit_price: '6.80',
    description: 'Piments de Nabeul, ail et carvi. Bocal verre 350 g.',
  },
  {
    key: 'olives',
    name: 'Olives de table 500 g',
    sku: 'OLV-500',
    unit_price: '7.50',
    description: 'Olives vertes cassées, saumure légère.',
  },
  {
    key: 'tapenade',
    name: 'Tapenade d’olives noires 200 g',
    sku: 'TAP-200',
    unit_price: '9.20',
    description: 'Olives noires, câpres et huile d’olive extra vierge.',
  },
];

const PACKAGING = [
  { key: 'b1l', name: 'Bouteille verre 1 L', unit: 'pièce', unit_cost: '0.95' },
  { key: 'bidon5', name: 'Bidon 5 L', unit: 'pièce', unit_cost: '2.40' },
  { key: 'bocal350', name: 'Bocal verre 350 g', unit: 'pièce', unit_cost: '0.70' },
  { key: 'bocal200', name: 'Bocal verre 200 g', unit: 'pièce', unit_cost: '0.55' },
  { key: 'carton6', name: 'Carton 6 bouteilles', unit: 'carton', unit_cost: '1.10' },
  { key: 'etiquette', name: 'Étiquette adhésive', unit: 'rouleau de 1000', unit_cost: '42.00' },
  { key: 'palette', name: 'Palette bois 80x120', unit: 'pièce', unit_cost: '12.00' },
];

/** Who sells what, with the negotiated price where one was agreed. */
const SUPPLIER_PRODUCTS = [
  ['huilerie', 'hoev1', '12.40'],
  ['huilerie', 'hoev5', '58.00'],
  ['huilerie', 'hov1', '9.80'],
  ['comptoir', 'olives', '4.30'],
  ['comptoir', 'harissa', '3.60'],
  ['comptoir', 'tapenade', '5.10'],
];

const SUPPLIER_PACKAGING = [
  ['verrerie', 'b1l', '0.88'],
  ['verrerie', 'bidon5', '2.25'],
  ['verrerie', 'bocal350', '0.64'],
  ['verrerie', 'bocal200', '0.49'],
  ['cartonnerie', 'carton6', '0.95'],
  ['cartonnerie', 'palette', '11.00'],
  ['imprimerie', 'etiquette', '38.50'],
];

/** The bill of materials: what each finished product consumes. */
const PRODUCT_PACKAGING = [
  ['hoev1', 'b1l', 1],
  ['hoev1', 'etiquette', 1],
  ['hoev1', 'carton6', 1],
  ['hoev5', 'bidon5', 1],
  ['hoev5', 'etiquette', 1],
  ['hov1', 'b1l', 1],
  ['hov1', 'etiquette', 1],
  ['harissa', 'bocal350', 1],
  ['harissa', 'etiquette', 1],
  ['olives', 'bocal350', 1],
  ['tapenade', 'bocal200', 1],
  ['tapenade', 'etiquette', 1],
];

// --- Ledger generation ------------------------------------------------------------------------

/**
 * The ledger runs from the first of the month three months back, up to today — where "today"
 * means the **local** calendar day, not the UTC one.
 *
 * The two disagree for an hour either side of midnight in Tunisia (UTC+1), and it matters here:
 * the Mini App sends `?on=<local today>` to the summary endpoint, so a ledger anchored to the UTC
 * day would leave the dashboard's "Today" tiles reading zero whenever this is run late in the
 * evening. The rows themselves are still stored at UTC midnight, like every other date in this
 * codebase.
 */
const now = new Date();
const LAST_DAY = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
const FIRST_DAY = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 3, 1));

/** A SQL DATE is read and written at UTC midnight everywhere else in this codebase. */
function utcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function* eachDay(from, to) {
  for (let d = utcDay(from); d <= utcDay(to); d.setUTCDate(d.getUTCDate() + 1)) {
    yield new Date(d);
  }
}

const WHOLESALE_BUYERS = [
  'Épicerie Carthage, La Marsa',
  'Supérette El Fath, Sousse',
  'Marché Bab El Khadra',
  'Restaurant Dar Zarrouk',
  'Épicerie fine Sidi Bou',
  'Grossiste Médina Distribution',
];

/**
 * Build the transaction rows.
 *
 * Every amount is plausible for a business this size in TND, and the mix is what a real cash
 * ledger looks like: a daily takings line on every selling day, a handful of larger wholesale
 * invoices a month, and the recurring costs landing on the days they actually land on — salaries
 * at month end, utilities mid-month, rent on the first.
 */
function buildLedger({ categories, userIds, supplierIds, productIds, packagingIds }) {
  random = makeRandom(SEED);

  const cat = (name) => {
    const found = categories.find((c) => c.name === name);
    if (!found) throw new Error(`Category "${name}" is missing — the seeded categories changed.`);
    return found.id;
  };

  const rows = [];
  /** Spreads authorship when more than one real user survived. */
  const author = () => pick(userIds);

  for (const day of eachDay(FIRST_DAY, LAST_DAY)) {
    const dow = day.getUTCDay(); // 0 = Sunday
    const dom = day.getUTCDate();
    const isLastOfMonth =
      new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), dom + 1)).getUTCDate() === 1;

    // --- Income: the Sunday market stall ---
    // The shop itself is shut, but a stand at the weekly market is common enough here to be
    // worth modelling, and it keeps Sundays from reading as missing data rather than a closed day.
    if (dow === 0 && chance(0.3)) {
      rows.push({
        category_id: cat('recettes'),
        type: 'INCOME',
        amount: money(420, 980),
        transaction_date: day,
        payment_method: 'CASH',
        description: 'Marché du dimanche — stand',
        user_id: author(),
      });
    }

    // --- Income: counter takings, every day but Sunday ---
    if (dow !== 0) {
      const saturday = dow === 6;
      rows.push({
        category_id: cat('recettes'),
        type: 'INCOME',
        amount: saturday ? money(820, 1750) : money(310, 1180),
        transaction_date: day,
        payment_method: chance(0.78) ? 'CASH' : 'CARD',
        description: saturday ? 'Recette du jour — samedi (marché)' : 'Recette du jour',
        user_id: author(),
      });

      // A second, smaller line on about a third of days — a late afternoon till count.
      if (chance(0.32)) {
        rows.push({
          category_id: cat('recettes'),
          type: 'INCOME',
          amount: money(80, 340),
          transaction_date: day,
          payment_method: 'CASH',
          description: 'Recette de l’après-midi',
          user_id: author(),
        });
      }
    }

    // --- Income: wholesale invoices, ~3 a month, paid by transfer ---
    if (dow !== 0 && chance(0.1)) {
      rows.push({
        category_id: cat('recettes'),
        type: 'INCOME',
        amount: money(1450, 6200),
        transaction_date: day,
        payment_method: chance(0.75) ? 'BANK_TRANSFER' : 'CHECK',
        description: `Vente en gros — ${pick(WHOLESALE_BUYERS)}`,
        user_id: author(),
      });
    }

    // --- Expense: oil and produce from the growers, a few times a month ---
    if ((dow === 2 || dow === 5) && chance(0.55)) {
      const [supplierKey, productKey] = pick([
        ['huilerie', 'hoev1'],
        ['huilerie', 'hoev5'],
        ['huilerie', 'hov1'],
        ['comptoir', 'olives'],
        ['comptoir', 'harissa'],
        ['comptoir', 'tapenade'],
      ]);
      rows.push({
        category_id: cat('suppliers'),
        type: 'EXPENSE',
        amount: supplierKey === 'huilerie' ? money(1850, 6400) : money(420, 1600),
        transaction_date: day,
        payment_method: chance(0.6) ? 'BANK_TRANSFER' : 'CHECK',
        description: `Achat marchandise — ${SUPPLIERS.find((s) => s.key === supplierKey).name}`,
        supplier_id: supplierIds[supplierKey],
        product_id: productIds[productKey],
        user_id: author(),
      });
    }

    // --- Expense: bottles, jars, cartons, labels ---
    if (dow === 3 && chance(0.6)) {
      const [supplierKey, packagingKey] = pick([
        ['verrerie', 'b1l'],
        ['verrerie', 'bidon5'],
        ['verrerie', 'bocal350'],
        ['cartonnerie', 'carton6'],
        ['cartonnerie', 'palette'],
        ['imprimerie', 'etiquette'],
      ]);
      rows.push({
        category_id: cat('packaging'),
        type: 'EXPENSE',
        amount: money(260, 1450),
        transaction_date: day,
        payment_method: chance(0.5) ? 'BANK_TRANSFER' : 'CHECK',
        description: `${PACKAGING.find((p) => p.key === packagingKey).name} — ${
          SUPPLIERS.find((s) => s.key === supplierKey).name
        }`,
        supplier_id: supplierIds[supplierKey],
        packaging_id: packagingIds[packagingKey],
        user_id: author(),
      });
    }

    // --- Expense: deliveries and fuel ---
    if (chance(0.14)) {
      rows.push({
        category_id: cat('transport'),
        type: 'EXPENSE',
        amount: chance(0.6) ? money(55, 140) : money(180, 420),
        transaction_date: day,
        payment_method: chance(0.7) ? 'CASH' : 'CARD',
        description: chance(0.6) ? 'Carburant camionnette' : 'Livraison Tunis / Sousse',
        ...(chance(0.4) ? { supplier_id: supplierIds.transit } : {}),
        user_id: author(),
      });
    }

    // --- Expense: payroll, at month end ---
    if (isLastOfMonth) {
      rows.push({
        category_id: cat('salaries'),
        type: 'EXPENSE',
        amount: money(4600, 5200),
        transaction_date: day,
        payment_method: 'BANK_TRANSFER',
        description: 'Salaires du mois — 5 employés',
        user_id: author(),
      });
      rows.push({
        category_id: cat('charges fixes'),
        type: 'EXPENSE',
        amount: money(310, 460),
        transaction_date: day,
        payment_method: 'BANK_TRANSFER',
        description: 'CNSS — cotisations',
        user_id: author(),
      });
    }

    // --- Expense: the recurring fixed costs, on the days they fall ---
    if (dom === 1) {
      rows.push({
        category_id: cat('charges fixes'),
        type: 'EXPENSE',
        amount: '900.00',
        transaction_date: day,
        payment_method: 'CHECK',
        description: 'Loyer atelier et dépôt',
        user_id: author(),
      });
    }
    if (dom === 12) {
      rows.push({
        category_id: cat('charges fixes'),
        type: 'EXPENSE',
        amount: money(290, 520),
        transaction_date: day,
        payment_method: 'BANK_TRANSFER',
        description: 'STEG — électricité',
        user_id: author(),
      });
    }
    if (dom === 15) {
      rows.push({
        category_id: cat('charges fixes'),
        type: 'EXPENSE',
        amount: money(68, 125),
        transaction_date: day,
        payment_method: 'BANK_TRANSFER',
        description: 'SONEDE — eau',
        user_id: author(),
      });
      rows.push({
        category_id: cat('subscriptions'),
        type: 'EXPENSE',
        amount: '69.00',
        transaction_date: day,
        payment_method: 'CARD',
        description: 'Internet fibre — abonnement mensuel',
        user_id: author(),
      });
      rows.push({
        category_id: cat('subscriptions'),
        type: 'EXPENSE',
        amount: '120.00',
        transaction_date: day,
        payment_method: 'BANK_TRANSFER',
        description: 'Logiciel de comptabilité — abonnement',
        user_id: author(),
      });
    }
    if (dom === 20) {
      rows.push({
        category_id: cat('subscriptions'),
        type: 'EXPENSE',
        amount: money(38, 62),
        transaction_date: day,
        payment_method: 'CARD',
        description: 'Téléphonie mobile',
        user_id: author(),
      });
    }

    // --- Expense: the odds and ends ---
    if (chance(0.07)) {
      rows.push({
        category_id: cat('divers'),
        type: 'EXPENSE',
        amount: money(18, 110),
        transaction_date: day,
        payment_method: 'CASH',
        description: pick([
          'Fournitures de bureau',
          'Produits d’entretien atelier',
          'Petit outillage',
          'Café et eau pour l’équipe',
          'Frais bancaires',
        ]),
        user_id: author(),
      });
    }
  }

  // --- The handful of one-off movements, placed on fixed days so the set stays reproducible ---

  const dayOffset = (n) => {
    const d = utcDay(FIRST_DAY);
    d.setUTCDate(d.getUTCDate() + n);
    return d > utcDay(LAST_DAY) ? utcDay(LAST_DAY) : d;
  };

  rows.push({
    category_id: cat('prets'),
    type: 'INCOME',
    amount: '15000.00',
    transaction_date: dayOffset(4),
    payment_method: 'BANK_TRANSFER',
    description: 'Crédit d’exploitation — déblocage (36 mois)',
    user_id: userIds[0],
  });

  for (const offset of [34, 64, 89]) {
    rows.push({
      category_id: cat('prets'),
      type: 'EXPENSE',
      amount: '1250.00',
      transaction_date: dayOffset(offset),
      payment_method: 'BANK_TRANSFER',
      description: 'Échéance crédit d’exploitation',
      user_id: userIds[0],
    });
  }

  rows.push({
    category_id: cat('investissements'),
    type: 'EXPENSE',
    amount: '4500.00',
    transaction_date: dayOffset(23),
    payment_method: 'CHECK',
    description: 'Embouteilleuse semi-automatique (occasion)',
    supplier_id: supplierIds.verrerie,
    user_id: userIds[0],
  });

  rows.push({
    category_id: cat('investissements'),
    type: 'EXPENSE',
    amount: '1280.00',
    transaction_date: dayOffset(58),
    payment_method: 'BANK_TRANSFER',
    description: 'Chambre froide — acompte',
    user_id: userIds[0],
  });

  rows.push({
    category_id: cat('sponsoring'),
    type: 'EXPENSE',
    amount: '650.00',
    transaction_date: dayOffset(40),
    payment_method: 'CASH',
    description: 'Tournoi de quartier — maillots floqués',
    user_id: userIds[0],
  });

  rows.push({
    category_id: cat('sponsoring'),
    type: 'EXPENSE',
    amount: '480.00',
    transaction_date: dayOffset(76),
    payment_method: 'BANK_TRANSFER',
    description: 'Festival de l’olive — stand',
    user_id: userIds[0],
  });

  // The dashboard's first screen is "today", so guarantee the last day carries something. On a
  // closed Sunday that is the market stand; otherwise the day's takings.
  const lastDay = utcDay(LAST_DAY);
  const hasToday = rows.some((r) => r.transaction_date.getTime() === lastDay.getTime());
  if (!hasToday) {
    const sunday = lastDay.getUTCDay() === 0;
    rows.push({
      category_id: cat('recettes'),
      type: 'INCOME',
      amount: sunday ? money(420, 980) : money(310, 1180),
      transaction_date: lastDay,
      payment_method: 'CASH',
      description: sunday ? 'Marché du dimanche — stand' : 'Recette du jour',
      user_id: userIds[0],
    });
  }

  return rows.sort((a, b) => a.transaction_date - b.transaction_date);
}

// --- Run --------------------------------------------------------------------------------------

const prisma = new PrismaClient();
const dbUrl = process.env.DATABASE_URL ?? '';
const dbHost = dbUrl.replace(/^[^@]*@/, '').split('/')[0] || '(unset)';

console.log(`\nTarget database: ${dbHost}`);

/**
 * Refuse the transaction pooler.
 *
 * Everything below runs inside one interactive transaction, which needs a session held open
 * across statements. Supabase's pooler on **6543** is in transaction mode and hands a different
 * backend to each statement, so the run would fail somewhere in the middle — after the deletes.
 * The session pooler on **5432** behaves like a direct connection. (The app itself is the other
 * way round: it wants 6543, because a serverless function should not hold a session.)
 */
if (/:6543|pgbouncer=true/.test(dbUrl)) {
  console.error(
    '\nRefusing to run against the transaction pooler (port 6543 / pgbouncer=true).\n' +
      'This script needs one long transaction, so use the SESSION pooler instead:\n' +
      '  postgresql://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:5432/postgres\n',
  );
  await prisma.$disconnect();
  process.exit(1);
}
console.log(
  APPLY
    ? 'Mode: APPLY — this will delete and rewrite data.\n'
    : 'Mode: DRY RUN — nothing will be written.\n',
);

const existingUsers = await prisma.users.findMany({ orderBy: { id: 'asc' } });
const keep = existingUsers.filter((u) => isRealTelegramUser(u.id));
const drop = existingUsers.filter((u) => !isRealTelegramUser(u.id));

console.log('Users to KEEP (real Telegram accounts):');
for (const u of keep)
  console.log(`  ${u.id}  "${u.first_name}"${u.username ? ` @${u.username}` : ''}`);
if (keep.length === 0) console.log('  (none)');

console.log('Users to DELETE:');
for (const u of drop)
  console.log(`  ${u.id}  "${u.first_name}" — below the Telegram id floor or in the test block`);
if (drop.length === 0) console.log('  (none)');

if (keep.length === 0) {
  console.error(
    '\nRefusing to continue: every transaction needs an owner, and no real Telegram user was found.\n' +
      'Open the Mini App from Telegram once to create your user row, or pass --keep=<id>.',
  );
  await prisma.$disconnect();
  process.exit(1);
}

const categories = await prisma.categories.findMany({ orderBy: { id: 'asc' } });
const userIds = keep.map((u) => u.id);

const before = {
  transactions: await prisma.transactions.count(),
  invoices: await prisma.invoices.count(),
  suppliers: await prisma.suppliers.count(),
  products: await prisma.products.count(),
  packaging: await prisma.packaging.count(),
};

// Ids are only known after insertion, so the dry run plans against placeholders.
const placeholder = (list) => Object.fromEntries(list.map((x, i) => [x.key, i + 1]));
const plannedLedger = buildLedger({
  categories,
  userIds,
  supplierIds: placeholder(SUPPLIERS),
  productIds: placeholder(PRODUCTS),
  packagingIds: placeholder(PACKAGING),
});

const sum = (type) =>
  plannedLedger
    .filter((r) => r.type === type)
    .reduce((total, r) => total + Number(r.amount), 0)
    .toFixed(2);

console.log('\nWill delete:');
console.log(`  ${before.transactions} transactions, ${before.invoices} invoices`);
console.log(
  `  ${before.suppliers} suppliers, ${before.products} products, ${before.packaging} packaging rows`,
);
console.log(`  ${drop.length} user(s), and every relationship link`);
console.log('\nWill insert:');
console.log(
  `  ${SUPPLIERS.length} suppliers, ${PRODUCTS.length} products, ${PACKAGING.length} packaging`,
);
console.log(
  `  ${SUPPLIER_PRODUCTS.length + SUPPLIER_PACKAGING.length + PRODUCT_PACKAGING.length} relationship links`,
);
console.log(`  ${plannedLedger.length} transactions, ${firstDate()} → ${lastDate()}`);
console.log(`     income   ${sum('INCOME')} TND`);
console.log(`     expenses ${sum('EXPENSE')} TND`);
console.log(
  `     cash position ${(Number(sum('INCOME')) - Number(sum('EXPENSE'))).toFixed(2)} TND (opening balance 0)`,
);
console.log('\nCategories are left untouched.');

function firstDate() {
  return plannedLedger[0]?.transaction_date.toISOString().slice(0, 10) ?? '-';
}
function lastDate() {
  return plannedLedger.at(-1)?.transaction_date.toISOString().slice(0, 10) ?? '-';
}

if (!APPLY) {
  console.log('\nDry run only. Re-run with --yes to apply.\n');
  await prisma.$disconnect();
  process.exit(0);
}

// The invoice files are stored outside the database, so collect their names before the rows go.
const orphanedFiles = (await prisma.invoices.findMany({ select: { image_url: true } })).map(
  (i) => i.image_url,
);

await prisma.$transaction(
  async (tx) => {
    // Order matters: links and invoices reference the rows below them.
    await tx.invoices.deleteMany({});
    await tx.transactions.deleteMany({});
    await tx.supplier_products.deleteMany({});
    await tx.supplier_packaging.deleteMany({});
    await tx.product_packaging.deleteMany({});
    await tx.suppliers.deleteMany({});
    await tx.products.deleteMany({});
    await tx.packaging.deleteMany({});
    if (drop.length > 0) {
      await tx.users.deleteMany({ where: { id: { in: drop.map((u) => u.id) } } });
    }

    const supplierIds = {};
    for (const { key, ...data } of SUPPLIERS) {
      supplierIds[key] = (await tx.suppliers.create({ data, select: { id: true } })).id;
    }
    const productIds = {};
    for (const { key, ...data } of PRODUCTS) {
      productIds[key] = (await tx.products.create({ data, select: { id: true } })).id;
    }
    const packagingIds = {};
    for (const { key, ...data } of PACKAGING) {
      packagingIds[key] = (await tx.packaging.create({ data, select: { id: true } })).id;
    }

    await tx.supplier_products.createMany({
      data: SUPPLIER_PRODUCTS.map(([s, p, price]) => ({
        supplier_id: supplierIds[s],
        product_id: productIds[p],
        unit_price: price,
      })),
    });
    await tx.supplier_packaging.createMany({
      data: SUPPLIER_PACKAGING.map(([s, k, price]) => ({
        supplier_id: supplierIds[s],
        packaging_id: packagingIds[k],
        unit_price: price,
      })),
    });
    await tx.product_packaging.createMany({
      data: PRODUCT_PACKAGING.map(([p, k, quantity]) => ({
        product_id: productIds[p],
        packaging_id: packagingIds[k],
        quantity,
      })),
    });

    // Rebuilt with the real ids now that the catalogue exists.
    const ledger = buildLedger({ categories, userIds, supplierIds, productIds, packagingIds });
    await tx.transactions.createMany({
      data: ledger.map((r) => ({ ...r, currency: 'TND' })),
    });
  },
  // Prisma's default interactive-transaction budget is five seconds, which is ample against
  // localhost and nowhere near enough against a hosted database: this does eight deletes, nineteen
  // creates and four bulk inserts, each a round trip. Timing out mid-way would roll back cleanly,
  // but only after wasting the run, so the ceiling is raised rather than discovered.
  { timeout: 180_000, maxWait: 30_000 },
);

// Remove the files the deleted invoices pointed at, when they are on this machine's disk.
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads/invoices');
let filesRemoved = 0;
if (orphanedFiles.length > 0) {
  const onDisk = await readdir(uploadDir).catch(() => null);
  if (onDisk) {
    for (const name of orphanedFiles) {
      const base = path.basename(name);
      if (onDisk.includes(base)) {
        await unlink(path.join(uploadDir, base)).catch(() => undefined);
        filesRemoved += 1;
      }
    }
  }
  if (filesRemoved < orphanedFiles.length) {
    console.log(
      `\nNote: ${orphanedFiles.length - filesRemoved} invoice file(s) were not on this machine's disk —` +
        ' they are in the Supabase bucket and have to be removed there if you want them gone.',
    );
  }
}

const after = {
  transactions: await prisma.transactions.count(),
  suppliers: await prisma.suppliers.count(),
  products: await prisma.products.count(),
  packaging: await prisma.packaging.count(),
  invoices: await prisma.invoices.count(),
  users: await prisma.users.count(),
};

console.log('\nDone. Row counts now:');
for (const [k, v] of Object.entries(after)) console.log(`  ${k.padEnd(14)} ${v}`);
if (filesRemoved > 0) console.log(`  invoice files deleted from disk: ${filesRemoved}`);

await prisma.$disconnect();
