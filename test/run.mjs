/**
 * Test runner wrapper.
 *
 * Enables TypeScript type-stripping (`--experimental-strip-types`) on Node
 * versions that support it (>= 22.6) so the Cloudflare Worker adapter
 * (cloudflare/worker.ts) can be tested directly. On older Node versions the
 * flag is omitted (it would be rejected as a bad option) and the Cloudflare
 * suite skips itself gracefully instead of failing the run.
 *
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsTypeStripping = major > 22 || (major === 22 && minor >= 6);

// Node's --test only expands glob patterns on >= 21; on 18/20 a literal
// 'test/**/*.test.js' matches nothing and npm test fails despite
// engines: >=18. Collect the files ourselves so every version behaves the same.
function collectTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTestFiles(p));
    else if (entry.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const args = [];
if (supportsTypeStripping) {
  args.push('--experimental-strip-types');
}
args.push('--test', ...collectTestFiles('test'));

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
