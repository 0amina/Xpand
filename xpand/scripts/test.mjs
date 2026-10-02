/**
 * Test runner entry point.
 *
 * Node 20's built-in runner discovers only `*.test.js`-style names, and it does not expand globs
 * itself — so neither pointing `--test` at `src/` nor handing it a recursive glob finds a
 * TypeScript test. Rather than add a test framework for one missing glob, this walks `src/` and
 * hands the files to `tsx --test` explicitly. Works the same in cmd.exe, PowerShell and bash.
 *
 * Drop it the day the project moves to Node 22+, where `--test` expands globs natively.
 */
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

/** Every `*.test.ts` under a directory, recursively. */
async function findTests(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findTests(full)));
    } else if (entry.name.endsWith('.test.ts')) {
      found.push(path.relative(root, full));
    }
  }
  return found;
}

const tests = (await findTests(srcDir)).sort();

if (tests.length === 0) {
  console.error('No *.test.ts files found under src/.');
  process.exit(1);
}

console.log(`Running ${tests.length} test file(s):`);
for (const file of tests) console.log(`  ${file}`);
console.log('');

// `tsx` resolves from node_modules/.bin; shell:true so Windows finds the .cmd shim.
const child = spawn('tsx', ['--test', ...process.argv.slice(2), ...tests], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 1));
