import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, appendFile, symlink } from 'fs/promises'
import path from 'path'
import os from 'os'
import { createChokidarFsEventSource } from '../src/adapters/chokidar-fs-event-source.js'
import type { FsEvent, FsEventSource } from '../src/ports/fs-event-source.js'

/**
 * A directory symlinked into a watched root *after* the watcher started (#194).
 *
 * Measured against a live server before this was fixed: the link is reported, the
 * project is listed and its content indexed once — and then editing a file in it
 * produces nothing at all. No `change` event, so no reload broadcast and no index
 * patch. The tree silently freezes at the state it had when it appeared, which is
 * indistinguishable from a healthy one.
 *
 * Roots present at boot are unaffected, because their realpaths are resolved up
 * front. This is only about entries that appear afterwards.
 *
 * These tests drive real chokidar against a real temp directory, so every wait
 * below re-runs its stimulus rather than trusting a fixed settle delay: under the
 * suite's parallel load an initial scan can take several seconds, and a one-shot
 * wait made this file pass alone and fail alongside the other watcher suites.
 */
let tmp: string
let src: FsEventSource | null

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-symlink-events-'))
  src = null
})
afterEach(async () => {
  if (src) await src.close().catch(() => {})
  await rm(tmp, { recursive: true, force: true })
})

/** Repeat `stimulus` until `seen` observes its event, or give up loudly. */
async function until(
  what: string,
  stimulus: () => Promise<unknown>,
  seen: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await stimulus()
    const round = Date.now() + 500
    while (Date.now() < round) {
      if (seen()) return
      await new Promise((r) => setTimeout(r, 25))
    }
  }
  throw new Error(`${what}: no matching event within ${timeoutMs}ms`)
}

/**
 * A live watcher on a root, plus a directory symlinked in after it started.
 *
 * The probe write proves the watcher is live on the root *before* the link is
 * introduced, so a later failure is about the symlink rather than about startup.
 */
async function linkedRoot() {
  const root = path.join(tmp, 'Root')
  const external = path.join(tmp, 'external-project')
  await mkdir(root, { recursive: true })
  await mkdir(external, { recursive: true })
  await writeFile(path.join(external, 'doc.md'), '# doc')

  const events: FsEvent[] = []
  src = createChokidarFsEventSource({ roots: [root] })
  src.subscribe((e) => events.push(e))

  const probe = path.join(root, 'probe.md')
  await until('watcher live on the root', () => writeFile(probe, 'probe'), () =>
    events.some((e) => e.path === probe),
  )

  const link = path.join(root, 'linked')
  await symlink(external, link)
  await until(
    'symlink noticed',
    async () => {},
    () => events.some((e) => e.path.includes('linked') || e.path.includes('external-project')),
  )
  events.length = 0

  const viaLink = path.join(link, 'doc.md')
  const viaReal = path.join(external, 'doc.md')

  return {
    events,
    /** The file, by both spellings — chokidar may report either. */
    viaLink,
    viaReal,
    /**
     * Only `change` events for that file.
     *
     * Filtering on kind is load-bearing, not tidiness: re-watching the directory
     * makes chokidar scan it and emit `add` for what it finds, so an assertion that
     * matched on path alone could pick up that `add` and fail on its kind. It did —
     * on macOS CI only, where the ordering differs from Linux.
     */
    changes: () => events.filter((e) => e.kind === 'change' && (e.path === viaLink || e.path === viaReal)),
  }
}

/**
 * Edit the file until a change event for it lands, and return those events.
 *
 * Throws if none arrives, which is the real assertion — before the fix this is
 * exactly where it hung, with nothing delivered by either spelling.
 */
async function editUntilChange(linked: Awaited<ReturnType<typeof linkedRoot>>): Promise<FsEvent[]> {
  await until(
    'edit inside the symlinked directory',
    () => appendFile(linked.viaReal, '\nmore'),
    () => linked.changes().length > 0,
  )
  return linked.changes()
}

describe('a directory symlinked into a root after the watcher started', () => {
  it(
    'delivers change events for files inside it',
    async () => {
      // Asserting on the count rather than re-checking `kind`, which the filter
      // already selected on — that would pass by construction.
      expect(await editUntilChange(await linkedRoot())).not.toHaveLength(0)
    },
    60_000,
  )

  it(
    'reports the path under the root, so the event names a project',
    async () => {
      // The spelling is not cosmetic. `toProjectRelativePath` turns the event path
      // into `<project>/<rel>` for the reload broadcast, and it can only do that
      // for a path under a configured root — a realpath outside every root yields
      // null, and the edit would be seen and then dropped for naming reasons.
      const linked = await linkedRoot()
      const changes = await editUntilChange(linked)
      expect(changes[0].path).toBe(linked.viaLink)
    },
    60_000,
  )
})
