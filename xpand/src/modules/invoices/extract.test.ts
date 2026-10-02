import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  extractCurrency,
  extractDate,
  extractInvoiceFields,
  extractInvoiceNumber,
  extractSupplier,
  extractTotal,
  parseAmount,
} from './extract.js';

/**
 * Real Tesseract output, not a hand-written ideal.
 *
 * This is what `tesseract.js` (fra+eng) actually returned for a rendered Tunisian invoice —
 * including the artefacts that matter: `N°` came back as `N.`, the table columns collapsed into
 * single spaced lines, and the totals block carries HT, TVA and TTC on separate lines. Writing
 * the fixture by hand would have quietly removed exactly the cases the parser has to survive.
 */
const REAL_OCR_OUTPUT = `SOCIETE TUNISIENNE DE PACKAGING
12 Rue de Carthage, 1000 Tunis

MF: 1234567/A/M/000

FACTURE N. FAC-2026-0457

Date de facture : 18/09/2026

Client : Xpand SARL

Designation Qte P.U. Montant
Cartons 40x30 100 2,400 240,000
Etiquettes adhesives 500 0,150 75,000
Ruban adhesif 20 3,500 70,000

Total HT 385,000

TVA 19% 73,150

Total TTC 458,150 TND
Net a payer : 458,150 TND

Mode de paiement : Virement bancaire
`;

describe('parseAmount', () => {
  it('reads a comma as the decimal separator (French/TND)', () => {
    assert.equal(parseAmount('458,15'), '458.15');
    assert.equal(parseAmount('2,40'), '2.40');
  });

  it('treats three trailing digits as millimes, not thousands', () => {
    // The 1000x decision documented in extract.ts. 458,150 TND is 458 dinars 150 millimes.
    assert.equal(parseAmount('458,150'), '458.15');
    assert.equal(parseAmount('385,000'), '385.00');
  });

  it('handles a space as the thousands separator', () => {
    assert.equal(parseAmount('1 234,560'), '1234.56');
    assert.equal(parseAmount('12 500,00'), '12500.00');
  });

  it('resolves both separators by taking the rightmost as the decimal point', () => {
    assert.equal(parseAmount('1.234,56'), '1234.56'); // European
    assert.equal(parseAmount('1,234.56'), '1234.56'); // Anglo
  });

  it('treats repeated separators as grouping', () => {
    assert.equal(parseAmount('1.234.567'), '1234567.00');
  });

  it('treats four or more trailing digits as grouping, since no invoice has 4 decimals', () => {
    assert.equal(parseAmount('12,3456'), '123456.00');
  });

  it('strips currency symbols and stray text', () => {
    assert.equal(parseAmount('458,150 TND'), '458.15');
    assert.equal(parseAmount('€ 1 200,50'), '1200.50');
  });

  it('returns null when there is no number', () => {
    assert.equal(parseAmount('Net a payer :'), null);
    assert.equal(parseAmount(''), null);
  });

  it('rejects values beyond NUMERIC(12,2)', () => {
    assert.equal(parseAmount('99999999999999'), null);
  });
});

describe('extractTotal', () => {
  it('prefers the tax-inclusive total over Total HT', () => {
    // The whole point of the label ordering: picking HT would understate every expense.
    const result = extractTotal(REAL_OCR_OUTPUT);
    assert.equal(result?.value, '458.15');
  });

  it('falls back to a bare Total when no TTC line exists', () => {
    const result = extractTotal('Designation\nTotal 120,500');
    assert.equal(result?.value, '120.50');
  });

  it('skips a zero total and keeps looking', () => {
    const result = extractTotal('Total TTC 0,000\nNet a payer : 95,000');
    assert.equal(result?.value, '95.00');
  });

  it('carries the matched text so the user can verify it', () => {
    const result = extractTotal(REAL_OCR_OUTPUT);
    assert.ok(result?.raw.includes('458,150'), `raw was ${result?.raw}`);
  });

  it('returns null when nothing resembles a total', () => {
    assert.equal(extractTotal('SOCIETE X\n12 Rue de Carthage'), null);
  });
});

describe('extractDate', () => {
  it('reads a labelled day-first date', () => {
    assert.equal(extractDate(REAL_OCR_OUTPUT)?.value, '2026-09-18');
  });

  it('is day-first, never month-first', () => {
    // 03/09 must be 3 September. Month-first would silently shift the books.
    assert.equal(extractDate('Date de facture : 03/09/2026')?.value, '2026-09-03');
  });

  it('accepts dash and dot separators', () => {
    assert.equal(extractDate('Date : 18-09-2026')?.value, '2026-09-18');
    assert.equal(extractDate('Date : 18.09.2026')?.value, '2026-09-18');
  });

  it('accepts an already-ISO date', () => {
    assert.equal(extractDate('Date : 2026-09-18')?.value, '2026-09-18');
  });

  it('reads French month names', () => {
    assert.equal(extractDate('Date de facture : 18 septembre 2026')?.value, '2026-09-18');
    assert.equal(extractDate('Date : 1er août 2026')?.value, '2026-08-01');
  });

  it('expands a two-digit year', () => {
    assert.equal(extractDate('Date : 18/09/26')?.value, '2026-09-18');
  });

  it('rejects an impossible calendar date', () => {
    assert.equal(extractDate('Date : 31/02/2026'), null);
  });

  it('prefers the labelled date over an unlabelled one appearing earlier', () => {
    const text = 'Echeance 01/01/2027\nDate de facture : 18/09/2026';
    assert.equal(extractDate(text)?.value, '2026-09-18');
  });
});

describe('extractInvoiceNumber', () => {
  it('survives Tesseract reading N° as N.', () => {
    assert.equal(extractInvoiceNumber(REAL_OCR_OUTPUT)?.value, 'FAC-2026-0457');
  });

  it('handles the degree-sign variants', () => {
    assert.equal(extractInvoiceNumber('Facture N° FAC-2026-0457')?.value, 'FAC-2026-0457');
    assert.equal(extractInvoiceNumber('Facture No FAC-2026-0457')?.value, 'FAC-2026-0457');
    assert.equal(extractInvoiceNumber('FACTURE #FAC-2026-0457')?.value, 'FAC-2026-0457');
  });

  it('reads the English spelling', () => {
    assert.equal(extractInvoiceNumber('Invoice No: INV-0088')?.value, 'INV-0088');
  });

  it('ignores a label followed by prose instead of a reference', () => {
    // "Facture: Societe Tunisienne" must not yield a company name as the invoice number.
    assert.equal(extractInvoiceNumber('Facture : Societe Tunisienne'), null);
  });

  it('returns null when there is no reference at all', () => {
    assert.equal(extractInvoiceNumber('Total TTC 458,150'), null);
  });
});

describe('extractCurrency', () => {
  it('reads TND', () => {
    assert.equal(extractCurrency(REAL_OCR_OUTPUT)?.value, 'TND');
  });

  it('maps the everyday Tunisian abbreviations', () => {
    assert.equal(extractCurrency('Total : 458,150 DT')?.value, 'TND');
    assert.equal(extractCurrency('Total : 458,150 د.ت')?.value, 'TND');
  });

  it('recognises other currencies', () => {
    assert.equal(extractCurrency('Total: 1 200,50 EUR')?.value, 'EUR');
    assert.equal(extractCurrency('Total: € 1 200,50')?.value, 'EUR');
    assert.equal(extractCurrency('Total: $99.00')?.value, 'USD');
  });

  it('returns null when no currency is printed', () => {
    assert.equal(extractCurrency('Total TTC 458,150'), null);
  });
});

describe('extractSupplier', () => {
  const known = [
    { id: 7, name: 'Société Tunisienne de Packaging' },
    { id: 9, name: 'Packaging' },
  ];

  it('matches a known supplier and returns its id', () => {
    const { supplier, supplierId } = extractSupplier(REAL_OCR_OUTPUT, known);
    assert.equal(supplierId, 7);
    assert.equal(supplier?.value, 'Société Tunisienne de Packaging');
  });

  it('matches accent-insensitively, since OCR drops accents', () => {
    // The fixture reads "SOCIETE", the database holds "Société".
    const { supplierId } = extractSupplier('SOCIETE TUNISIENNE DE PACKAGING', known);
    assert.equal(supplierId, 7);
  });

  it('prefers the longest matching supplier name', () => {
    // "Packaging" (id 9) also appears in the text; the specific match must win.
    const { supplierId } = extractSupplier(REAL_OCR_OUTPUT, known);
    assert.equal(supplierId, 7);
  });

  it('falls back to the letterhead with no id when the supplier is unknown', () => {
    const { supplier, supplierId } = extractSupplier(REAL_OCR_OUTPUT, []);
    assert.equal(supplierId, null);
    assert.equal(supplier?.value, 'SOCIETE TUNISIENNE DE PACKAGING');
  });

  it('skips boilerplate lines when reading the letterhead', () => {
    const text = 'FACTURE\nMF: 1234567/A/M/000\nETS BEN ALI ET FILS\nTotal 10,000';
    const { supplier } = extractSupplier(text, []);
    assert.equal(supplier?.value, 'ETS BEN ALI ET FILS');
  });

  it('returns null when nothing looks like a company name', () => {
    const { supplier } = extractSupplier('FACTURE\n12345\nTVA\n', []);
    assert.equal(supplier, null);
  });
});

describe('extractInvoiceFields', () => {
  it('extracts all five fields from real OCR output', () => {
    const result = extractInvoiceFields(REAL_OCR_OUTPUT, [
      { id: 7, name: 'Société Tunisienne de Packaging' },
    ]);

    assert.equal(result.supplierId, 7);
    assert.equal(result.invoiceDate?.value, '2026-09-18');
    assert.equal(result.totalAmount?.value, '458.15');
    assert.equal(result.currency?.value, 'TND');
    assert.equal(result.invoiceNumber?.value, 'FAC-2026-0457');
    assert.deepEqual(result.missingFields, []);
  });

  it('reports what it could not read instead of throwing', () => {
    const result = extractInvoiceFields('\n\n   \n', []);
    assert.deepEqual(result.missingFields.sort(), [
      'currency',
      'invoiceDate',
      'invoiceNumber',
      'supplierName',
      'totalAmount',
    ]);
  });

  it('offers any plausible first line as the supplier, by design', () => {
    // The letterhead fallback is deliberately permissive — a wrong suggestion the user can see
    // and overwrite beats an empty field, because the review screen is mandatory either way.
    // It is only ever a suggestion: `supplierId` stays null, so nothing is linked without a pick.
    const result = extractInvoiceFields('a blank page', []);
    assert.equal(result.supplierName?.value, 'a blank page');
    assert.equal(result.supplierId, null);
    assert.ok(!result.missingFields.includes('supplierName'));
  });

  it('never throws on adversarial input', () => {
    for (const text of ['', '\n\n\n', '0'.repeat(5000), '€'.repeat(100), 'Total Total Total']) {
      assert.doesNotThrow(() => extractInvoiceFields(text, []));
    }
  });
});
