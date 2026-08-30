/**
 * Test runner wrapper.
 *
 * Enables TypeScript type-stripping (`--experimental-strip-types`) on every
 * supported Node line so the Cloudflare Worker adapter can be tested directly.
 *
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsTypeStripping = major > 22 || (major === 22 && minor >= 6);

// Collect the files ourselves so nested tests behave identically on Windows
// and Linux without shell-specific glob expansion.
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
