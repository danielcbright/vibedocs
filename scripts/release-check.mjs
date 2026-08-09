#!/usr/bin/env node
// Pre-tag guard. Run via `npm run release:check` before cutting a release.
//
// Releasing vibedocs is `git push origin v<version>`; the `release` workflow
// then publishes to npm via OIDC trusted publishing with no human in the loop.
// That is a good thing — no long-lived token, automatic provenance — but it
// means the tag push is the point of no return. Everything a human used to
// catch by pausing mid-ritual has to be caught here.
//
// The verdict logic is pure (`checkReleaseReadiness`) and unit-tested in
// tests/release-check.test.ts; the rest of this file gathers real git/npm state
// and prints the result.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Decide whether the repo is in a state where tagging a release is safe.
 *
 * Pure. Collects every problem rather than stopping at the first, so one run
 * tells you the whole list.
 *
 * @param {object} state
 * @param {string} state.version               package.json version.
 * @param {string} state.gitStatusPorcelain    `git status --porcelain` output.
 * @param {string} state.branch                Current branch name.
 * @param {number} state.ahead                 Commits ahead of upstream.
 * @param {number} state.behind                Commits behind upstream.
 * @param {string[]} state.existingTags        Tags that already exist.
 * @param {string[]} state.publishedVersions   Versions already on the registry.
 * @returns {{ ok: boolean, tag: string, problems: string[], warnings: string[] }}
 */
export function checkReleaseReadiness({
  version,
  gitStatusPorcelain,
  branch,
  ahead,
  behind,
  existingTags,
  publishedVersions,
}) {
  const tag = `v${version}`;
  const problems = [];
  const warnings = [];

  if (gitStatusPorcelain.trim() !== '') {
    problems.push(
      'working tree is not clean — the tag would point at a commit that does not ' +
        'contain your uncommitted changes',
    );
  }

  if (publishedVersions.includes(version)) {
    problems.push(
      `${version} is already published to the registry — bump the version first ` +
        '(npm refuses to republish a version, so the release job would fail)',
    );
  }

  if (existingTags.includes(tag)) {
    problems.push(`tag ${tag} already exists — bump the version or delete the tag`);
  }

  if (ahead > 0) {
    problems.push(
      `${ahead} local commit(s) not pushed to origin — push first, otherwise the ` +
        'tag drags commits into CI that never landed on the branch',
    );
  }

  if (behind > 0) {
    problems.push(`branch is ${behind} commit(s) behind origin — pull first`);
  }

  if (branch !== 'main') {
    warnings.push(`releasing from '${branch}', not main — intentional for a hotfix line, ` +
      'otherwise probably a mistake');
  }

  return { ok: problems.length === 0, tag, problems, warnings };
}

// ---------------------------------------------------------------------------
// Side-effecting shell. Skipped when imported (e.g. by the unit tests).
// ---------------------------------------------------------------------------

function git(args, fallback = '') {
  const result = spawnSync('git', args, { cwd: packageDir, encoding: 'utf-8' });
  return result.status === 0 ? (result.stdout ?? '').trim() : fallback;
}

function publishedVersionsFromRegistry(name) {
  const result = spawnSync('npm', ['view', name, 'versions', '--json'], {
    cwd: packageDir,
    encoding: 'utf-8',
  });
  // A package that has never been published exits non-zero (E404) — that is a
  // legitimate state for a first release, not an error.
  if (result.status !== 0) return [];
  try {
    const parsed = JSON.parse(result.stdout ?? '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function main() {
  const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf-8'));

  // `git rev-list --count --left-right @{upstream}...HEAD` prints "behind\tahead".
  const [behindRaw, aheadRaw] = git(
    ['rev-list', '--count', '--left-right', '@{upstream}...HEAD'],
    '0\t0',
  ).split(/\s+/);

  const state = {
    version: pkg.version,
    gitStatusPorcelain: git(['status', '--porcelain']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
    ahead: Number(aheadRaw) || 0,
    behind: Number(behindRaw) || 0,
    existingTags: git(['tag', '--list']).split('\n').filter(Boolean),
    publishedVersions: publishedVersionsFromRegistry(pkg.name),
  };

  const { ok, tag, problems, warnings } = checkReleaseReadiness(state);

  console.log(`[release-check] ${pkg.name}@${state.version} on '${state.branch}'`);
  console.log(`[release-check] proposed tag: ${tag}`);

  for (const warning of warnings) console.log(`  ! ${warning}`);

  if (!ok) {
    console.error('');
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error('\n[release-check] NOT ready to release');
    process.exit(1);
  }

  console.log('[release-check] ready');
  console.log('');
  console.log('Next, in order:');
  console.log('  npm run verify        # typecheck + both suites');
  console.log('  npm run pack:inspect  # prove the tarball ships the runtime surface');
  console.log(`  git tag -a ${tag} -m "release: ${tag}" && git push origin ${tag}`);
  console.log('');
  console.log('The release workflow publishes from the tag via OIDC — no local token.');
}

// Only run when executed directly, so importing the pure function is free.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
