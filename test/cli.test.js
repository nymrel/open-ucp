/**
 * CLI scaffold filesystem boundary regressions.
 *
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/open-ucp.js', import.meta.url));

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'open-ucp-cli-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, target: join(cwd, 'ucp.config.json') };
}

function init(cwd, args = [], nodeArgs = []) {
  const result = spawnSync(process.execPath, [...nodeArgs, cli, 'init', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('CLI init creates the starter configuration with supplied merchant fields', (t) => {
  const { cwd, target } = fixture(t);
  const output = init(cwd, ['--name', 'Fixture Merchant', '--email', 'fixture@example.com']);
  const config = JSON.parse(readFileSync(target, 'utf8'));
  assert.equal(config.manifest.entity.name, 'Fixture Merchant');
  assert.equal(config.manifest.entity.contactEmail, 'fixture@example.com');
  assert.match(output, /Scaffolded starter UCP configuration/);
});

test('CLI init preserves an existing file unless --force is supplied', (t) => {
  const { cwd, target } = fixture(t);
  const sentinel = 'keep this existing configuration\n';
  writeFileSync(target, sentinel);
  assert.match(init(cwd), /already exists.*Use --force to overwrite/);
  assert.equal(readFileSync(target, 'utf8'), sentinel);

  assert.match(init(cwd, ['--force']), /Scaffolded starter UCP configuration/);
  assert.equal(JSON.parse(readFileSync(target, 'utf8')).manifest.ucpVersion, '1.0.0');
});

test('CLI init refuses a dangling symlink without creating its target', (t) => {
  const { cwd, target } = fixture(t);
  const destination = join(cwd, 'must-not-be-created.json');
  try {
    symlinkSync(destination, target, 'file');
  } catch (err) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(err.code)) {
      t.skip(`File symlinks are unavailable: ${err.code}`);
      return;
    }
    throw err;
  }
  assert.match(init(cwd), /already exists.*Use --force to overwrite/);
  assert.equal(existsSync(destination), false);
});

test('CLI init preserves a file inserted immediately before the filesystem write', (t) => {
  const { cwd, target } = fixture(t);
  const preload = join(cwd, 'concurrent-create.cjs');
  const sentinel = 'created by another process\n';
  // Inject a deterministic interleaving at the filesystem boundary instead of
  // depending on process scheduling to reproduce a race.
  writeFileSync(preload, `
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalWrite = fs.writeFileSync;
fs.writeFileSync = function (file, ...args) {
  if (file === ${JSON.stringify(target)}) {
    originalWrite.call(this, file, ${JSON.stringify(sentinel)});
  }
  return originalWrite.call(this, file, ...args);
};
syncBuiltinESMExports();
`);
  assert.match(init(cwd, [], ['--require', preload]), /already exists.*Use --force to overwrite/);
  assert.equal(readFileSync(target, 'utf8'), sentinel);
});
