# invoices module

Invoice upload, OCR, and the review step that turns a read invoice into a transaction.

Base path: `/api/invoices`. All routes require the `x-telegram-id` header (or Mini App initData)
and nothing more — reads and writes alike are open to any authenticated user.

## The one rule

**An unverified draft is never a transaction.**

OCR output lands in `invoices.ocr_extracted_data` and nowhere else. The `transactions` table gains
a row only in `POST /:id/confirm`, from values the user submitted on the review screen.

The alternative — writing drafts as real transactions flagged "unverified" — would mean every
cash-position and by-category report had to filter them out correctly, forever, and the first place
that forgot would silently overstate the company's money. Keeping drafts out of the ledger entirely
means no report can be wrong.

## Pipeline

```
POST /api/invoices  (multipart image)
      │
      ├─ validate type + size ──────────► 400 with an actionable reason
      ├─ write bytes to UPLOAD_DIR
      ├─ INSERT invoices (status PENDING)
      └─ 201, then OCR runs in the background
            │
            ├─ status PROCESSING  (compare-and-set, so a double retry cannot run twice)
            ├─ tesseract.js reads the page            → ocr_raw_text
            ├─ extract.ts pulls the five fields       → ocr_extracted_data
            └─ status READY   (or FAILED + ocr_error)

GET /api/invoices/:id        ← client polls here while PENDING/PROCESSING; carries `draft`
POST /api/invoices/:id/confirm  ← the user's verified values → INSERT transactions + link, atomically
```

`status` is the pipeline state:

| Status       | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| `PENDING`    | Stored, OCR not started.                                   |
| `PROCESSING` | OCR in flight.                                             |
| `READY`      | Extraction done, draft awaiting a person.                  |
| `FAILED`     | OCR failed. The user can still fill the draft by hand.     |
| `CONFIRMED`  | Verified; `transaction_id` is set.                          |

## Endpoints

| Method & path                      | Notes                                                                 |
| ---------------------------------- | --------------------------------------------------------------------- |
| `POST   /api/invoices`             | `multipart/form-data`, field name `file`. 201 with status `PENDING`.  |
| `GET    /api/invoices`             | Newest first. `?status=` and `?transactionId=` filters. `meta.awaitingReview` counts everything not yet confirmed. |
| `GET    /api/invoices/:id`         | The invoice plus its `draft` (null until OCR finishes). Poll this.    |
| `GET    /api/invoices/:id/file`    | The stored image. Authenticated — see below.                          |
| `GET    /api/invoices/:id/raw-text`| What the OCR engine read, verbatim.                                   |
| `POST   /api/invoices/:id/retry-ocr` | Read the page again. Also unsticks a row left `PROCESSING` by a crash. |
| `POST   /api/invoices/:id/confirm` | **Creates the transaction.** 409 if already confirmed.                 |
| `POST   /api/invoices/:id/link`    | Attach to a transaction that already exists. Creates nothing.          |
| `DELETE /api/invoices/:id`         | Discards an unconfirmed invoice and its file. 409 once confirmed.      |

### Why `confirm` and `link` are separate

`confirm` *creates* a transaction from a draft. `link` only files an image against an entry already
in the ledger. Conflating them is how you double-book an expense that was already logged by hand —
which is exactly what draining the frontend's old `localStorage` queue would have done.

## What OCR extracts

Five fields, each returned with the **raw text it was read from**:

```json
{
  "supplierName":  { "value": "Societe Tunisienne de Packaging", "raw": "Societe Tunisienne de Packaging" },
  "supplierId":    6,
  "invoiceDate":   { "value": "2026-09-18", "raw": "Date de facture : 18/09/2026" },
  "totalAmount":   { "value": "458.15",     "raw": "Net a payer : 458,150" },
  "currency":      { "value": "TND",        "raw": "TND" },
  "invoiceNumber": { "value": "FAC-2026-0457", "raw": "FACTURE N. FAC-2026-0457" },
  "missingFields": [],
  "suggestedCategoryId": 2,
  "ocrConfidence": 93
}
```

`raw` is not decoration. The review screen renders it beside each value, because the amount parser
has to resolve a genuine ambiguity (below) and the user is the only one who can settle it.

### Engine

`tesseract.js` (WASM), languages from `OCR_LANGS` — `fra+eng` by default, since invoices here are
French. One long-lived worker is reused and jobs are serialised; see `ocr.ts`.

First run downloads `<lang>.traineddata` into `TESSDATA_DIR` and needs network access for that.
Afterwards it is fully offline. Without `TESSDATA_DIR` set, Tesseract writes those multi-megabyte
blobs into the process CWD — i.e. the repo root.

### Extraction heuristics (`extract.ts`)

Tesseract returns text; turning text into fields is hand-written and locale-specific. Two stated
assumptions, not detected per document:

- **Comma is the decimal separator.** `458,150` is 458 dinars 150 millimes.
- **Dates are day-first.** `03/09/2026` is 3 September, never 9 March.

Three decisions worth knowing about:

1. **Total labels are ordered, tax-inclusive first.** An invoice shows `Total HT`, `TVA`, then
   `Total TTC` / `Net à payer`. Matching a bare `Total` first would reliably pick the pre-tax
   figure and **understate every expense**.
2. **A single separator with three trailing digits is read as millimes**, not thousands grouping.
   `458,150` → `458.15`. The two readings differ by 1000×, TND is a three-decimal currency, and
   this is the dominant case on a Tunisian invoice. It is still a guess — hence `raw`.
3. **Suppliers are matched against the `suppliers` table first.** That is the strongest available
   signal and it yields a `supplier_id`, which is what the transaction actually needs. The
   letterhead fallback gives a name with no id, and the UI then offers to pick or create one.

The third decimal is lost to rounding: `transactions.amount` is `NUMERIC(12,2)`.

Run the extraction tests with `npm test` — they exercise real Tesseract output, including the
artefacts that matter (`N°` read as `N.`, collapsed table columns).

## Storage

Files go to `UPLOAD_DIR` under a generated UUID name, never the user's filename (which is attacker
controlled and collides across phones). The original name is kept in a column for display only.

`invoices.image_url` holds that **storage key, not a URL** — a column-name misnomer inherited from
the original schema. The servable URL is derived from the row id at the API boundary.

Files are served **only** through `GET /:id/file`, behind the auth middleware. They are deliberately
not mounted with `express.static`: that would put every receipt the company has behind a guessable
URL with no authentication in front of it.

## Images only

Accepted: `image/jpeg`, `image/png`, `image/webp`. A PDF is rejected at upload with a message
telling the user to photograph it instead.

Tesseract is an image OCR engine. Supporting PDF means either reading its embedded text layer
(not OCR at all, and absent on a scanned PDF) or rasterising to pixels first (native dependencies).
Accepting a PDF and failing later would be worse than a clear boundary up front. **This is the
obvious next extension** — see the frontend README's pending list.

## Configuration

| Variable        | Default               | Notes                                                        |
| --------------- | --------------------- | ------------------------------------------------------------ |
| `UPLOAD_DIR`    | `./uploads/invoices`  | Created on first upload. Gitignored.                         |
| `MAX_UPLOAD_MB` | `10`                  | Phone photos are typically 2-6 MB.                           |
| `OCR_LANGS`     | `fra+eng`             | `+`-joined. Each language adds worker warm-up time.          |
| `TESSDATA_DIR`  | `./.tessdata`         | Language-data cache. Gitignored.                             |
| `OCR_ENABLED`   | `true`                | `false` still accepts uploads; they land `FAILED` with a message and the user fills the draft by hand. |

## Schema notes

The `invoices` table was originally transaction-first: `transaction_id NOT NULL UNIQUE`. That cannot
express this workflow, where a file is stored and read *before* any transaction exists. The migration
made the link nullable (Postgres allows many NULLs under a UNIQUE constraint) and it is filled in at
confirm time.

`verified` (boolean) was dropped in favour of `status`: a boolean could not express "OCR is running"
or "OCR failed", and two columns that can disagree about whether money was approved is exactly the
bug you do not want in a ledger.

`ON DELETE CASCADE` on `transaction_id` means deleting a transaction removes its invoice row too —
which is why `DELETE /:id` refuses a confirmed invoice and points at the transaction instead.

## curl

```bash
# Upload
curl -X POST localhost:3000/api/invoices -H 'x-telegram-id: 111' -F 'file=@invoice.jpg'

# Poll until status leaves PENDING/PROCESSING
curl localhost:3000/api/invoices/1 -H 'x-telegram-id: 111'

# See what the engine actually read
curl localhost:3000/api/invoices/1/raw-text -H 'x-telegram-id: 111'

# Confirm — these values, not the OCR's, become the transaction
curl -X POST localhost:3000/api/invoices/1/confirm \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{"categoryId":2,"amount":"458.15","transactionDate":"2026-09-18",
       "paymentMethod":"BANK_TRANSFER","supplierId":6,"invoiceNumber":"FAC-2026-0457"}'
```

## Error responses you can trigger

| Status | How                                                                              |
| ------ | -------------------------------------------------------------------------------- |
| 400    | Upload a PDF or a `.txt`; omit the `file` field; use a field name other than `file`; exceed `MAX_UPLOAD_MB`; confirm with a bad amount or a non-existent `supplierId`. |
| 401    | Request `/:id/file` with no credential.                                          |
| 404    | Unknown invoice id; or the row exists but its bytes are gone from `UPLOAD_DIR`.   |
| 409    | Confirm twice; confirm while still `PROCESSING`; delete or re-OCR a confirmed invoice; link to a transaction that already has one. |
