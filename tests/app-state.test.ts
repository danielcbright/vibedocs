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

describe('AppState — broadcast on tree change', () => {
  it('emits reload(<project-relative path>) when a markdown file changes', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'notes.md'), '# n\n')

    const { state, fsEvents, channel } = buildState()
    await state.start()

    fsEvents.emit({ kind: 'change', path: path.join(projectDir, 'notes.md') })

    expect(channel.sent).toEqual([{ type: 'reload', path: 'alpha/notes.md' }])
    await state.shutdown()
  })

  it('emits refresh-tree (NOT reload) when a non-markdown file changes', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })

    const { state, fsEvents, channel } = buildState()
    await state.start()

    fsEvents.emit({ kind: 'change', path: path.join(projectDir, 'logo.png') })

    expect(channel.sent).toEqual([{ type: 'refresh-tree' }])
    await state.shutdown()
  })

  it('emits refresh-tree on add/unlink/addDir/unlinkDir', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })

    const { state, fsEvents, channel } = buildState()
    await state.start()

    fsEvents.emit({ kind: 'add', path: path.join(projectDir, 'new.md') })
    fsEvents.emit({ kind: 'unlink', path: path.join(projectDir, 'old.md') })
    fsEvents.emit({ kind: 'addDir', path: path.join(projectDir, 'sub') })
    fsEvents.emit({ kind: 'unlinkDir', path: path.join(projectDir, 'gone') })

    // Each event triggers refresh-tree (and only refresh-tree, regardless of
    // markdown-ness of the path — markdown adds/unlinks rebuild search but
    // still broadcast as tree changes).
    expect(channel.sent).toEqual([
      { type: 'refresh-tree' },
      { type: 'refresh-tree' },
      { type: 'refresh-tree' },
      { type: 'refresh-tree' },
    ])
    await state.shutdown()
  })

  it('does NOT broadcast an absolute filesystem path on reload — only project-relative', async () => {
    // Defends against a leak where the wire payload would expose host layout.
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })

    const { state, fsEvents, channel } = buildState()
    await state.start()

    // Path outside projectsDir → toProjectRelativePath returns null → no reload.
    fsEvents.emit({ kind: 'change', path: '/etc/hosts' })

    // It still broadcasts refresh-tree (non-markdown branch), but not a reload.
    expect(channel.sent.every((m) => m.type !== 'reload')).toBe(true)
    await state.shutdown()
  })
})

describe('AppState — interface delegates', () => {
  it('exposes uploadAuth as the snapshot passed at construction', async () => {
    const cfg = parseUploadAuthConfig({ VIBEDOCS_UPLOAD_TOKEN: 'sekret' })
    const { state } = buildState({ uploadAuth: cfg })
    expect(state.uploadAuth).toBe(cfg)
    expect(state.uploadAuth.token).toBe('sekret')
    await state.shutdown()
  })

  it('listProjects returns projects with siteConfig attached', async () => {
    await mkdir(path.join(tmpDir, 'alpha'), { recursive: true })
    await writeFile(path.join(tmpDir, 'alpha', 'README.md'), '# alpha\n')
    await mkdir(path.join(tmpDir, 'beta'), { recursive: true })
    await writeFile(path.join(tmpDir, 'beta', 'README.md'), '# beta\n')

    const { state } = buildState()
    const projects = await state.listProjects()

    expect(projects.map((p) => p.name).sort()).toEqual(['alpha', 'beta'])
    // siteConfig is null when no .vibedocs.config.ts exists; key still present.
    expect(projects[0]).toHaveProperty('siteConfig')
    await state.shutdown()
  })
})

async function waitForVersion(state: { searchVersion: number }, target: number) {
  for (let i = 0; i < 50; i++) {
    if (state.searchVersion >= target) return
    await new Promise((r) => setTimeout(r, 10))
  }
}
