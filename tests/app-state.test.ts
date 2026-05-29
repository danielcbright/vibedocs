import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { createAppState } from '../src/app-state.js'
import { createInMemoryFsEventSource } from '../src/adapters/in-memory-fs-event-source.js'
import { createInMemoryClientChannel } from '../src/adapters/in-memory-client-channel.js'
import { parseUploadAuthConfig } from '../src/upload-auth.js'

/**
 * AppState is the live-mode orchestration module. Tests drive it without HTTP
 * via two in-memory adapters (FsEventSource + ClientChannel) and assert on
 * three observable side-effects: cache invalidation, search index version,
 * and broadcast messages.
 */

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-appstate-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function buildState(overrides: Partial<Parameters<typeof createAppState>[0]> = {}) {
  const fsEvents = createInMemoryFsEventSource()
  const channel = createInMemoryClientChannel()
  const state = createAppState({
    projectsDir: tmpDir,
    fsEventSource: fsEvents,
    clientChannel: channel,
    uploadAuth: parseUploadAuthConfig({}),
    ...overrides,
  })
  return { state, fsEvents, channel }
}

describe('AppState — cache invalidation on config change', () => {
  it('invalidates a project siteConfig entry when its .vibedocs.config.ts changes', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'README.md'), '# Alpha\n')

    const { state, fsEvents } = buildState()
    await state.start()

    // Seed the site-config cache by listing projects (exposes the loaded entry).
    await state.listProjects()
    expect(state.siteConfigCacheHas('alpha')).toBe(true)

    fsEvents.emit({
      kind: 'change',
      path: path.join(projectDir, '.vibedocs.config.ts'),
    })

    expect(state.siteConfigCacheHas('alpha')).toBe(false)

    await state.shutdown()
  })
})

describe('AppState — search index rebuild on markdown change', () => {
  it('bumps searchVersion when a markdown file changes', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'notes.md'), '# old\n')

    const { state, fsEvents } = buildState()
    await state.start()
    expect(state.searchVersion).toBe(1)

    await writeFile(path.join(projectDir, 'notes.md'), '# new content\nsphinx\n')
    fsEvents.emit({ kind: 'change', path: path.join(projectDir, 'notes.md') })

    // Search rebuild is fire-and-forget — drain pending microtasks until it lands.
    await waitForVersion(state, 2)
    expect(state.searchVersion).toBe(2)

    // And the new content is searchable.
    expect(state.search('sphinx')).toHaveLength(1)

    await state.shutdown()
  })

  it('does NOT rebuild the search index when a non-markdown file changes', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'logo.png'), 'fake-png')

    const { state, fsEvents } = buildState()
    await state.start()
    expect(state.searchVersion).toBe(1)

    fsEvents.emit({ kind: 'change', path: path.join(projectDir, 'logo.png') })

    // Wait a couple of microtasks to be sure no rebuild slipped through.
    await Promise.resolve()
    await Promise.resolve()
    expect(state.searchVersion).toBe(1)

    await state.shutdown()
  })
})

async function waitForVersion(state: { searchVersion: number }, target: number) {
  for (let i = 0; i < 50; i++) {
    if (state.searchVersion >= target) return
    await new Promise((r) => setTimeout(r, 10))
  }
}
