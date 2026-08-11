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
 * Decide whether the repo is in a state where pushing the release tag is safe.
 *
 * The precise question: **if I push HEAD and the v<version> tag right now, will
 * the release job succeed?** Anything that would not break that push is a
 * warning, never a blocker. That distinction matters more than it looks — the
 * natural place to run this is straight after `npm version`, which by design
 * leaves an unpushed commit and a freshly created tag. Treating either as a
 * failure would make the check cry wolf at the exact moment it is meant to be
 * useful, and a guard that blocks correct work gets removed rather than fixed.
 *
 * Pure. Collects every problem rather than stopping at the first.
 *
 * @param {object} state
 * @param {string} state.version               package.json version.
 * @param {string} state.gitStatusPorcelain    `git status --porcelain` output.
 * @param {string} state.branch                Current branch name.
 * @param {number} state.ahead                 Commits ahead of upstream.
 * @param {number} state.behind                Commits behind upstream.
 * @param {string[]} state.publishedVersions   Versions already on the registry.
 * @param {string} state.headSha               SHA of HEAD.
 * @param {string|null} state.tagSha           SHA the release tag points at, or
 *                                             null when the tag does not exist.
 * @returns {{ ok: boolean, tag: string, problems: string[], warnings: string[] }}
 */
export function checkReleaseReadiness({
  version,
  gitStatusPorcelain,
  branch,
  ahead,
  behind,
  publishedVersions,
  headSha,
  tagSha,
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

  // A tag left over from an abandoned attempt is the dangerous case: CI checks
  // out the tag, so it would build and publish a commit you are not looking at.
  if (tagSha !== null && tagSha !== headSha) {
    problems.push(
      `tag ${tag} exists but does not point at HEAD (${tagSha.slice(0, 8)} vs ` +
        `${headSha.slice(0, 8)}) — CI builds the tag, so it would publish a ` +
        `different commit. Delete it (git tag -d ${tag}) and re-tag, or bump the version`,
    );
  }

  if (behind > 0) {
    problems.push(`branch is ${behind} commit(s) behind origin — pull first`);
  }

  if (tagSha === null) {
    warnings.push(
      `no ${tag} tag yet — create it with \`npm version\` (or \`git tag -a ${tag}\`) ` +
        'before pushing',
    );
  }

  if (ahead > 0) {
    warnings.push(
      `${ahead} commit(s) not yet pushed — expected right after \`npm version\`. ` +
        'Push with --follow-tags so the tagged commit goes up with the tag',
    );
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

  const tag = `v${pkg.version}`;
  // `git rev-list -n1 <tag>` resolves an annotated tag through to the commit it
  // points at, which is what CI will actually check out. Empty means no tag.
  const tagSha = git(['rev-list', '-n', '1', tag], '') || null;

  const state = {
    version: pkg.version,
    gitStatusPorcelain: git(['status', '--porcelain']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
    ahead: Number(aheadRaw) || 0,
    behind: Number(behindRaw) || 0,
    publishedVersions: publishedVersionsFromRegistry(pkg.name),
    headSha: git(['rev-parse', 'HEAD'], ''),
    tagSha,
  };

  const { ok, problems, warnings } = checkReleaseReadiness(state);

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
  if (state.tagSha === null) {
    console.log(`  npm version <patch|minor|major>   # creates the commit and ${tag}`);
    console.log('  git push origin HEAD --follow-tags');
  } else {
    console.log(`  git push origin ${state.branch} --follow-tags   # sends HEAD and ${tag}`);
  }
  console.log('');
  console.log('The release workflow publishes from the tag via OIDC — no local token.');
}

// Only run when executed directly, so importing the pure function is free.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
