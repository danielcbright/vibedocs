#!/usr/bin/env node
// Release pre-flight: pack the package for real and assert the tarball ships
// the runtime surface. Run locally via `npm run pack:inspect`; run in CI by the
// `publish-rehearsal` job.
//
// Two ingredients are load-bearing and must not be "optimised" away:
//
//   * NO prior build step. If `prepare` fails to build the frontend during
//     pack, this must be what fails. Building first would mask exactly the bug
//     the gate exists for.
//   * NO `--ignore-scripts`. The lifecycle has to run as it would on publish.
//
// The verdict logic lives in tarball-contract.mjs so it is unit-tested and
// shared; this file is just the side-effecting shell around it.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTarballContents } from './tarball-contract.mjs';
import { envForChildNpm } from './prepare-plan.mjs';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const childEnv = envForChildNpm(process.env);

function run(command, args, { cwd = packageDir } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: childEnv,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    console.error(`\n[pack-inspect] \`${command} ${args.join(' ')}\` exited ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? '';
}

const destination = mkdtempSync(join(tmpdir(), 'vibedocs-pack-'));
console.log(`[pack-inspect] packing into ${destination}`);
console.log('[pack-inspect] this runs the real `prepare` lifecycle — expect a Vite build');

// npm pack writes progress to stderr and the tarball name to stdout, but the
// filename is not worth parsing when the destination is ours and empty.
run('npm', ['pack', '--pack-destination', destination]);

const tarballs = readdirSync(destination).filter((name) => name.endsWith('.tgz'));
if (tarballs.length !== 1) {
  console.error(`[pack-inspect] expected exactly one tarball, found ${tarballs.length}`);
  process.exit(1);
}
const tarball = join(destination, tarballs[0]);

const entries = run('tar', ['-tzf', tarball]).split('\n');
const { ok, errors, assetCount } = checkTarballContents(entries);

console.log(`[pack-inspect] tarball:              ${tarball}`);
console.log(`[pack-inspect] total entries:        ${entries.filter(Boolean).length}`);
console.log(`[pack-inspect] frontend asset files: ${assetCount}`);

if (!ok) {
  console.error('');
  for (const error of errors) {
    // GitHub Actions renders `::error::` as an annotation; harmless locally.
    console.error(process.env.GITHUB_ACTIONS ? `::error::${error}` : `  ✗ ${error}`);
  }
  console.error('\n[pack-inspect] FAILED — this tarball is not publishable');
  process.exit(1);
}

console.log('[pack-inspect] OK — tarball ships the full runtime surface');
