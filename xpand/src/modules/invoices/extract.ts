/**
 * Turning a page of OCR'd text into the five fields a transaction draft needs.
 *
 * This is the half of the OCR feature that Tesseract does not do for you. Tesseract returns
 * text; everything below is heuristics over that text, and heuristics are wrong sometimes —
 * which is precisely why nothing here writes to `transactions`. The output is a *draft* the
 * user reviews, and every field carries the raw substring it came from so the user can see
 * what was read rather than having to trust a number.
 *
 * Everything is a pure function of the text (plus, for suppliers, the known supplier list), so
 * it can be exercised against fixtures without a worker, a file, or a database.
 *
 * ## Locale assumptions
 *
 * Invoices here are Tunisian and written in French, which drives two decisions:
 *
 *  - **Comma is the decimal separator.** `458,150` is four hundred fifty-eight dinars and 150
 *    millimes, not four hundred fifty-eight thousand.
 *  - **Dates are day-first.** `03/09/2026` is 3 September, never 9 March.
 *
 * Both are stated rather than detected. A mixed-locale corpus would need real detection, and
 * guessing per-document would make the same invoice parse differently on different days.
 */

/** A value plus the exact text it was read from, so the UI can show its work. */
export interface Extracted<T> {
  value: T;
  /** The matching substring, trimmed. Shown next to the value for verification. */
  raw: string;
}

export interface InvoiceExtraction {
  supplierName: Extracted<string> | null;
  /** Matched against the `suppliers` table when the name is recognised. */
  supplierId: number | null;
  /** `YYYY-MM-DD`. */
  invoiceDate: Extracted<string> | null;
  /** A 2-decimal string, matching the `NUMERIC(12,2)` column. Never a float. */
  totalAmount: Extracted<string> | null;
  /** ISO-4217 where recognisable. */
  currency: Extracted<string> | null;
  invoiceNumber: Extracted<string> | null;
  /** Which of the five fields came back empty — the UI highlights these for attention. */
  missingFields: string[];
}

/** A supplier the matcher can recognise by name. */
export interface KnownSupplier {
  id: number;
  name: string;
}

// ---------------------------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------------------------

/**
 * Parse a localised money string into a 2-decimal string.
 *
 * The hard case is a single separator followed by exactly three digits — `458,150` or `458.150`.
 * In French text that could be thousands grouping (1.234 = one thousand two hundred thirty-four)
 * or, because TND is a three-decimal currency, millimes (458,150 = 458.15 TND). The two readings
 * differ by 1000×.
 *
 * This resolves it as **millimes**, because the amounts on a Tunisian invoice are TND and
 * three-decimal totals are the norm. That is a real guess, and it is why `raw` is carried
 * alongside every amount and rendered next to it in the review screen: the user sees
 * `458,150` beside `458.15` and can correct it in one tap. Do not remove that affordance.
 *
 * The third decimal is then lost to rounding, since `transactions.amount` is `NUMERIC(12,2)`.
 *
 * @returns a `"0.00"`-style string, or null if the input holds no parseable number.
 */
export function parseAmount(input: string): string | null {
  // Keep only characters that can belong to a number. This drops currency symbols, letters and
  // the space/apostrophe/non-breaking-space used for thousands grouping.
  const cleaned = input.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(cleaned)) return null;

  const negative = cleaned.trimStart().startsWith('-');
  const digitsAndSeps = cleaned.replace(/-/g, '');

  const lastComma = digitsAndSeps.lastIndexOf(',');
  const lastDot = digitsAndSeps.lastIndexOf('.');

  let normalised: string;

  if (lastComma >= 0 && lastDot >= 0) {
    // Both separators present: the rightmost is the decimal point, the other is grouping.
    const decimalAt = Math.max(lastComma, lastDot);
    const intPart = digitsAndSeps.slice(0, decimalAt).replace(/[.,]/g, '');
    const fracPart = digitsAndSeps.slice(decimalAt + 1).replace(/[.,]/g, '');
    normalised = `${intPart}.${fracPart}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const occurrences = digitsAndSeps.split(sep).length - 1;

    if (occurrences > 1) {
      // `1.234.567` — repeated separators can only be grouping.
      normalised = digitsAndSeps.replace(/[.,]/g, '');
    } else {
      const at = digitsAndSeps.indexOf(sep);
      const frac = digitsAndSeps.slice(at + 1);
      // 1-3 trailing digits → decimal (see the millimes note above). 4+ → grouping, since no
      // currency has four decimal places on an invoice.
      normalised =
        frac.length >= 1 && frac.length <= 3
          ? `${digitsAndSeps.slice(0, at)}.${frac}`
          : digitsAndSeps.replace(/[.,]/g, '');
    }
  } else {
    normalised = digitsAndSeps;
  }

  const n = Number(normalised);
  if (!Number.isFinite(n)) return null;

  const signed = negative ? -n : n;
  // Guard the column bound (NUMERIC(12,2)) so a misread does not blow up on insert.
  if (Math.abs(signed) > 9_999_999_999.99) return null;

  return signed.toFixed(2);
}

/**
 * Labels that introduce the payable total, best first.
 *
 * Order is the whole point. An invoice shows several totals — `Total HT` (pre-tax), `TVA`, then
 * `Total TTC` / `Net à payer` — and the one that belongs in the ledger is what was actually
 * paid, tax included. Matching `Total` first would reliably pick the pre-tax figure and
 * understate every expense.
 *
 * `\D{0,20}` lets the label and its number be separated by OCR noise (stray punctuation,
 * collapsed table columns) without letting the match run into the next row's digits.
 */
const TOTAL_LABELS: RegExp[] = [
  /net\s*[àa]\s*payer\D{0,20}([\d .,']+)/i,
  /montant\s*(?:total\s*)?(?:[àa]\s*payer|ttc)\D{0,20}([\d .,']+)/i,
  /total\s*(?:general|général)?\s*ttc\D{0,20}([\d .,']+)/i,
  /total\s*t\.?t\.?c\.?\D{0,20}([\d .,']+)/i,
  /grand\s*total\D{0,20}([\d .,']+)/i,
  /amount\s*due\D{0,20}([\d .,']+)/i,
  /total\s*(?:amount|due)\D{0,20}([\d .,']+)/i,
  // Last resort: a bare "Total". Deliberately after every tax-inclusive variant, and it will
  // match `Total HT` on an invoice that has no TTC line — flagged by `confidence`, not silently.
  /total\D{0,20}([\d .,']+)/i,
];

/**
 * The invoice total.
 *
 * Scans label patterns in priority order and, within a label, prefers the **last** occurrence:
 * invoices repeat "Total" down a page and the payable figure is at the bottom.
 */
export function extractTotal(text: string): Extracted<string> | null {
  for (const pattern of TOTAL_LABELS) {
    const matches = [...text.matchAll(new RegExp(pattern.source, 'gi'))];
    if (matches.length === 0) continue;

    // Walk from the bottom up — the summary block is below the line items.
    for (const match of matches.reverse()) {
      const captured = match[1];
      if (!captured) continue;
      const parsed = parseAmount(captured);
      // Zero and negatives are not payable invoice totals; keep looking.
      if (parsed !== null && Number(parsed) > 0) {
        return { value: parsed, raw: match[0].trim().replace(/\s+/g, ' ') };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------------------------

/**
 * Currency spellings seen on invoices here, mapped to ISO-4217.
 *
 * `DT` and `د.ت` are the everyday Tunisian abbreviations and appear far more often than `TND`.
 * Longest keys are matched first so `DNT` is not shadowed by `DT`.
 */
const CURRENCY_TOKENS: Array<[RegExp, string]> = [
  [/\bTND\b/i, 'TND'],
  [/\bDNT\b/i, 'TND'],
  [/\bDT\b/i, 'TND'],
  [/د\.?\s?ت/, 'TND'],
  [/\bdinars?\b/i, 'TND'],
  [/\bEUR\b/i, 'EUR'],
  [/€/, 'EUR'],
  [/\bUSD\b/i, 'USD'],
  [/\$/, 'USD'],
];

export function extractCurrency(text: string): Extracted<string> | null {
  for (const [pattern, code] of CURRENCY_TOKENS) {
    const match = pattern.exec(text);
    if (match) return { value: code, raw: match[0].trim() };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const FRENCH_MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  décembre: 12,
};

/** Build `YYYY-MM-DD`, or null when the parts do not form a real calendar date. */
function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Two-digit years: invoices are contemporary, so 26 → 2026.
  const fullYear = year < 100 ? 2000 + year : year;
  if (fullYear < 2000 || fullYear > 2100) return null;

  // Round-trip through Date to reject 31 February and friends.
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${fullYear}-${mm}-${dd}`;
}

/**
 * The invoice date.
 *
 * Prefers a date sitting next to a date label, because an invoice carries several (due date,
 * print date, period covered) and an unlabelled scan would pick whichever appears first.
 * Falls back to the first parseable date anywhere, then lets the user correct it.
 *
 * Day-first throughout — see the locale note at the top of the file.
 */
export function extractDate(text: string): Extracted<string> | null {
  const numeric = String.raw`(\d{1,4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})`;
  const monthNames = Object.keys(FRENCH_MONTHS).join('|');
  const textual = String.raw`(\d{1,2})\s*(?:er)?\s+(${monthNames})\s+(\d{4})`;

  const labelled = [
    new RegExp(String.raw`date\s*(?:de\s*)?(?:facture|facturation)?\s*:?\s*${numeric}`, 'i'),
    new RegExp(String.raw`(?:fait\s+le|le)\s*:?\s*${numeric}`, 'i'),
    new RegExp(String.raw`invoice\s*date\s*:?\s*${numeric}`, 'i'),
    new RegExp(String.raw`date\s*(?:de\s*)?(?:facture|facturation)?\s*:?\s*${textual}`, 'i'),
  ];

  for (const pattern of [...labelled, new RegExp(numeric), new RegExp(textual, 'i')]) {
    const match = pattern.exec(text);
    if (!match) continue;

    const [, a, b, c] = match;
    if (!a || !b || !c) continue;

    const monthFromName = FRENCH_MONTHS[b.toLowerCase()];
    const iso =
      monthFromName !== undefined
        ? // `12 septembre 2026`
          toIsoDate(Number(c), monthFromName, Number(a))
        : a.length === 4
          ? // Already `YYYY-MM-DD`.
            toIsoDate(Number(a), Number(b), Number(c))
          : // Day-first: `18/09/2026`.
            toIsoDate(Number(c), Number(b), Number(a));

    if (iso) return { value: iso, raw: match[0].trim().replace(/\s+/g, ' ') };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Invoice number
// ---------------------------------------------------------------------------------------------

/**
 * The invoice reference.
 *
 * `[N#]` plus an optional degree sign covers `N°`, `No`, `N.`, `Nº` and `#`. The degree sign is
 * worth spelling out: Tesseract routinely reads `N°` as `N.`, `N*` or `N"`, so the separator
 * between the label and the value is matched loosely — `[°ºo.:\s*"']*`.
 *
 * The captured value must contain a digit. Without that, `Facture: Societe X` would yield a
 * company name as the invoice number.
 */
const NUMBER_LABELS: RegExp[] = [
  /facture\s*[N#]?[°ºo.:\s*"']*([A-Z0-9][A-Z0-9/_-]{2,})/i,
  /(?:^|\s)[N#][°ºo.:\s*"']*\s*facture\s*:?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i,
  /invoice\s*(?:number|no|#)?[.:\s*"']*([A-Z0-9][A-Z0-9/_-]{2,})/i,
  /(?:r[ée]f(?:[ée]rence)?)\s*[.:\s]*([A-Z0-9][A-Z0-9/_-]{2,})/i,
];

export function extractInvoiceNumber(text: string): Extracted<string> | null {
  for (const pattern of NUMBER_LABELS) {
    const match = pattern.exec(text);
    const captured = match?.[1];
    if (!match || !captured) continue;

    const value = captured.replace(/[.,;:]+$/, '');
    // A reference with no digit in it is a misfire on surrounding prose.
    if (!/\d/.test(value)) continue;

    return { value: value.toUpperCase(), raw: match[0].trim().replace(/\s+/g, ' ') };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Supplier
// ---------------------------------------------------------------------------------------------

/** Fold case, strip accents and punctuation, collapse whitespace — for name comparison only. */
function normaliseName(value: string): string {
  return (
    value
      .normalize('NFD')
      // Combining diacritical marks, left over from NFD: "Société" → "Societe".
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Legal-form words and invoice boilerplate that must not be mistaken for a company name. */
const NOT_A_NAME =
  /^(facture|invoice|devis|bon\s|client|date|tel|t[ée]l|fax|email|e-mail|adresse|address|mf\b|tva|rib|total|designation|d[ée]signation|quantit|montant|page|www\.|http)/i;

/**
 * Who issued the invoice.
 *
 * Two strategies, strongest first:
 *
 *  1. **Match the `suppliers` table.** If a known supplier's name appears anywhere in the text
 *     this is near-certain, and it yields a `supplierId` — which is what the transaction
 *     actually needs, since `supplier_id` is a foreign key and a name string is not.
 *  2. **Read the letterhead.** Failing that, take the first plausible line from the top of the
 *     page, where the issuer's name sits on essentially every invoice. This gives a name with
 *     no id, and the review screen then offers to create the supplier or pick an existing one.
 *
 * Longer supplier names are tested first so "Société Tunisienne de Packaging" wins over a
 * supplier merely called "Packaging".
 */
export function extractSupplier(
  text: string,
  known: KnownSupplier[],
): { supplier: Extracted<string> | null; supplierId: number | null } {
  const haystack = normaliseName(text);

  const byLength = [...known].sort((a, b) => b.name.length - a.name.length);
  for (const supplier of byLength) {
    const needle = normaliseName(supplier.name);
    // Two characters is too short to be evidence of anything.
    if (needle.length < 3) continue;
    if (haystack.includes(needle)) {
      return { supplier: { value: supplier.name, raw: supplier.name }, supplierId: supplier.id };
    }
  }

  // Letterhead fallback: scan only the first few lines, where the issuer is.
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines.slice(0, 6)) {
    if (NOT_A_NAME.test(line)) continue;
    // Mostly-digit lines are tax ids, phone numbers or table rows.
    const letters = (line.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
    if (letters < 4 || letters < line.length / 2) continue;
    if (line.length > 80) continue;

    return { supplier: { value: line.replace(/\s+/g, ' '), raw: line }, supplierId: null };
  }

  return { supplier: null, supplierId: null };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Run every field extractor over one OCR'd page.
 *
 * Nothing here throws: a field that cannot be read comes back null and is listed in
 * `missingFields`, because a partial draft is still useful — the user fills the gaps on the
 * review screen either way.
 */
export function extractInvoiceFields(text: string, known: KnownSupplier[]): InvoiceExtraction {
  const { supplier, supplierId } = extractSupplier(text, known);
  const invoiceDate = extractDate(text);
  const totalAmount = extractTotal(text);
  const currency = extractCurrency(text);
  const invoiceNumber = extractInvoiceNumber(text);

  const missingFields: string[] = [];
  if (!supplier) missingFields.push('supplierName');
  if (!invoiceDate) missingFields.push('invoiceDate');
  if (!totalAmount) missingFields.push('totalAmount');
  if (!currency) missingFields.push('currency');
  if (!invoiceNumber) missingFields.push('invoiceNumber');

  return {
    supplierName: supplier,
    supplierId,
    invoiceDate,
    totalAmount,
    currency,
    invoiceNumber,
    missingFields,
  };
}
