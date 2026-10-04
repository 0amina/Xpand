/**
 * Copy invoice files from the local `UPLOAD_DIR` into the Supabase Storage bucket.
 *
 *   npm run files:migrate              # upload everything missing
 *   npm run files:migrate -- --dry-run # list what would be uploaded, touch nothing
 *
 * The companion to the database migration. `pg_dump`/`psql` move the `invoices` rows, but each
 * row's `image_url` is a storage key pointing at bytes that only exist on this laptop — so
 * without this step the records arrive and every review screen 404s.
 *
 * Driven by the rows, not by the directory listing: a file with no row is unreachable by the app
 * anyway (`GET /api/invoices/:id/file` is the only reader), and uploading it would just consume
 * quota. A row with no file is reported rather than skipped silently, because that is a real gap
 * someone should know about.
 *
 * Needs `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set, plus `UPLOAD_DIR` if
 * it is not the default. Point `DATABASE_URL` at whichever database holds the rows you are
 * migrating — the local one is the natural choice, since the keys are identical on both sides.
 *
 * Safe to re-run: an object that already exists is left alone unless `--force` is passed.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../dist/config/env.js';
import { prisma } from '../dist/db/prisma.js';

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '✖ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n' +
      '  Find them under Project Settings → API in the Supabase dashboard.',
  );
  process.exit(1);
}

const base = env.SUPABASE_URL.replace(/\/+$/, '');
const bucket = env.SUPABASE_STORAGE_BUCKET;
const auth = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
};

const objectUrl = (key) => `${base}/storage/v1/object/${bucket}/${key}`;

/** Whether the bucket already holds this key. */
async function alreadyThere(key) {
  const response = await fetch(`${base}/storage/v1/object/info/${bucket}/${key}`, {
    headers: auth,
  });
  return response.ok;
}

const rows = await prisma.invoices.findMany({
  select: { id: true, image_url: true, mime_type: true, file_size: true },
  orderBy: { id: 'asc' },
});

console.log(
  `${rows.length} invoice row(s) in the database; bucket "${bucket}" on ${base}` +
    (dryRun ? ' — DRY RUN, nothing will be written\n' : '\n'),
);

const summary = { uploaded: 0, skipped: 0, missing: 0, failed: 0 };

for (const row of rows) {
  const key = row.image_url;
  const local = path.join(path.resolve(env.UPLOAD_DIR), key);

  let bytes;
  try {
    bytes = await readFile(local);
  } catch {
    // The row outlived its bytes. Nothing to upload, and nothing this script can fix — but the
    // operator should know the review screen for this invoice will show "file is missing".
    console.log(`  ? invoice ${row.id}: no local file at ${local}`);
    summary.missing += 1;
    continue;
  }

  if (!force && (await alreadyThere(key))) {
    console.log(`  = invoice ${row.id}: already in the bucket`);
    summary.skipped += 1;
    continue;
  }

  if (dryRun) {
    console.log(`  + invoice ${row.id}: would upload ${key} (${bytes.byteLength} bytes)`);
    summary.uploaded += 1;
    continue;
  }

  const response = await fetch(objectUrl(key), {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': row.mime_type,
      // `--force` re-uploads over an existing object; without it the existence check above
      // already returned, so upsert is only ever reached deliberately.
      'x-upsert': force ? 'true' : 'false',
    },
    body: new Uint8Array(bytes),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error(`  ✖ invoice ${row.id}: ${response.status} ${detail}`);
    summary.failed += 1;
    continue;
  }

  // A size mismatch means the row's `file_size` no longer describes the bytes, which would make
  // `GET /api/invoices/:id/file` send a wrong Content-Length. Worth naming.
  if (row.file_size !== bytes.byteLength) {
    console.log(
      `  ! invoice ${row.id}: uploaded ${bytes.byteLength} bytes but the row says ${row.file_size}`,
    );
  }

  console.log(`  + invoice ${row.id}: uploaded ${key} (${bytes.byteLength} bytes)`);
  summary.uploaded += 1;
}

console.log(
  `\n${dryRun ? 'Would upload' : 'Uploaded'} ${summary.uploaded}, skipped ${summary.skipped}, ` +
    `missing locally ${summary.missing}, failed ${summary.failed}.`,
);

await prisma.$disconnect();
process.exit(summary.failed > 0 ? 1 : 0);
