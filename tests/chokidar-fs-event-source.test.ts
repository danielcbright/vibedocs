import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, appendFile, unlink } from 'fs/promises'
import path from 'path'
import os from 'os'
import { createChokidarFsEventSource } from '../src/adapters/chokidar-fs-event-source.js'
import type { FsEvent, FsEventSource } from '../src/ports/fs-event-source.js'

/**
 * Production adapter test: wires chokidar against a real tmpdir and asserts
 * the public FsEventSource contract — subscribe-then-emit delivers, close()
 * stops delivery, close() is idempotent. Chokidar is asynchronous so we use
 * a tiny waitFor helper rather than fixed sleeps.
 */

let tmpDir: string
let src: FsEventSource | null

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-chokidar-test-'))
  src = null
})

afterEach(async () => {
  if (src) {
    await src.close().catch(() => {})
  }
  await rm(tmpDir, { recursive: true, force: true })
})

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 5_000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`)
}

describe('createChokidarFsEventSource', () => {
  it('delivers `add` events when a file is created under the watched dir', async () => {
    src = createChokidarFsEventSource({ watchGlob: `${tmpDir}/**/*` })
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))

    // Give chokidar enough time to complete its initial scan + ready
    // handshake before mutating. Without this the first add fires before
    // the watcher is actually watching and we race the FS.
    await new Promise((r) => setTimeout(r, 300))

    const target = path.join(tmpDir, 'hello.md')
    await writeFile(target, '# hello')

    await waitFor(() =>
      received.some((ev) => ev.kind === 'add' && ev.path === target),
    )
  })

  it('delivers `change` events when an existing file is appended', async () => {
    const target = path.join(tmpDir, 'notes.md')
    await writeFile(target, '# initial')

    src = createChokidarFsEventSource({ watchGlob: `${tmpDir}/**/*` })
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))

    // Settle initial subscription before mutating to avoid the racy first-add
    // chokidar sometimes emits even with ignoreInitial when the file exists.
    await new Promise((r) => setTimeout(r, 200))
    await appendFile(target, '\nmore content\n')

    await waitFor(() =>
      received.some((ev) => ev.kind === 'change' && ev.path === target),
    )
  })

  it('delivers `unlink` events when a file is removed', async () => {
    const target = path.join(tmpDir, 'goodbye.md')
    await writeFile(target, 'bye')

    src = createChokidarFsEventSource({ watchGlob: `${tmpDir}/**/*` })
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))
    await new Promise((r) => setTimeout(r, 200))

    await unlink(target)

    await waitFor(() =>
      received.some((ev) => ev.kind === 'unlink' && ev.path === target),
    )
  })

  it('close() prevents further event delivery', async () => {
    src = createChokidarFsEventSource({ watchGlob: `${tmpDir}/**/*` })
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))
    await new Promise((r) => setTimeout(r, 200))

    await src.close()

    await writeFile(path.join(tmpDir, 'after-close.md'), 'late')
    // Give chokidar a generous window to mis-fire if it were going to.
    await new Promise((r) => setTimeout(r, 500))

    expect(received.some((ev) => ev.path.endsWith('after-close.md'))).toBe(false)
  })

  it('close() is idempotent — calling twice does not throw', async () => {
    src = createChokidarFsEventSource({ watchGlob: `${tmpDir}/**/*` })
    await src.close()
    await expect(src.close()).resolves.toBeUndefined()
  })

  it('fans out a single file event to multiple subscribers', async () => {
    src = createChokidarFsEventSource({ watchGlob: `${tmpDir}/**/*` })
    const a: FsEvent[] = []
    const b: FsEvent[] = []
    src.subscribe((ev) => a.push(ev))
    src.subscribe((ev) => b.push(ev))
    await new Promise((r) => setTimeout(r, 300))

    const target = path.join(tmpDir, 'fanout.md')
    await writeFile(target, 'x')

    await waitFor(() =>
      a.some((ev) => ev.path === target) && b.some((ev) => ev.path === target),
    )
  })
})
