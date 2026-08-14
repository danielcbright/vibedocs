import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
// @ts-expect-error — plain .mjs script module, no type declarations by design.
import { readSidecar, patchSidecar, sidecarPath, resolveRunsDir } from '../scripts/lib/run-sidecar.mjs'

/**
 * The sidecar now has two writers: the supervisor's identity, written once at
 * start, and the follower's position, written continuously. They must not erase
 * each other — losing the identity makes a hard-killed run unreapable, and losing
 * the position makes the next turn re-push the whole transcript.
 */
let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vibedocs-sidecar-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readSidecar', () => {
  it('returns null rather than throwing when there is nothing to read', () => {
    expect(readSidecar(dir, 'nope')).toBeNull()
  })

  it('returns null for a corrupt or non-object sidecar', async () => {
    // A half-written file must not take the run down; a fresh start is the
    // correct degradation.
    await mkdir(path.join(dir, 'a'), { recursive: true })
    await writeFile(sidecarPath(dir, 'a'), '{"pid": 1', 'utf8')
    expect(readSidecar(dir, 'a')).toBeNull()

    await writeFile(sidecarPath(dir, 'a'), '[1,2]', 'utf8')
    expect(readSidecar(dir, 'a')).toBeNull()
  })
})

describe('patchSidecar', () => {
  it('creates the run directory it writes into', () => {
    expect(patchSidecar(dir, 'fresh', { pid: 7 })).toBe(true)
    expect(readSidecar(dir, 'fresh')).toEqual({ pid: 7 })
  })

  it('merges rather than overwrites, so two writers can share the file', () => {
    // This is the whole reason the module exists. The identity write happens once
    // at startup — after a previous turn recorded a follow position — so a plain
    // write would reset the follower to byte 0 and re-push the transcript.
    patchSidecar(dir, 'r', { follow: { offset: 900, clientSeq: 12 } })
    patchSidecar(dir, 'r', { pid: 42, host: 'box' })

    expect(readSidecar(dir, 'r')).toEqual({
      follow: { offset: 900, clientSeq: 12 },
      pid: 42,
      host: 'box',
    })
  })

  it('replaces the follow block wholesale on each update', () => {
    // Position is one fact, not a set of independently-mergeable fields; a
    // deep merge could leave an offset paired with a stale inode.
    patchSidecar(dir, 'r', { follow: { offset: 100, ino: 1 } })
    patchSidecar(dir, 'r', { follow: { offset: 200 } })
    expect(readSidecar(dir, 'r').follow).toEqual({ offset: 200 })
  })

  it('reports failure instead of throwing when the path is unwritable', async () => {
    // Best-effort by contract: the caller carries on with a degraded resume
    // rather than failing the run.
    await writeFile(path.join(dir, 'file'), 'x', 'utf8')
    expect(patchSidecar(path.join(dir, 'file'), 'r', { pid: 1 })).toBe(false)
  })

  it('writes readable JSON, since this file gets inspected by hand', async () => {
    patchSidecar(dir, 'r', { pid: 1 })
    const raw = await readFile(sidecarPath(dir, 'r'), 'utf8')
    expect(raw).toContain('\n  "pid"')
    expect(raw.endsWith('\n')).toBe(true)
  })
})

describe('resolveRunsDir', () => {
  it('honours VIBEDOCS_RUNS_DIR, resolved to an absolute path', () => {
    expect(resolveRunsDir({ VIBEDOCS_RUNS_DIR: '/srv/runs' })).toBe('/srv/runs')
    expect(path.isAbsolute(resolveRunsDir({ VIBEDOCS_RUNS_DIR: 'runs' }))).toBe(true)
  })

  it('defaults to the same place the server does', () => {
    // A supervisor writing where the server does not look would leave every
    // hard-killed run unreapable.
    expect(resolveRunsDir({})).toMatch(/\.vibedocs[/\\]runs$/)
  })
})
