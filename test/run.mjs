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

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsTypeStripping = major > 22 || (major === 22 && minor >= 6);

const args = [];
if (supportsTypeStripping) {
  args.push('--experimental-strip-types');
}
args.push('--test', 'test/**/*.test.js');

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
