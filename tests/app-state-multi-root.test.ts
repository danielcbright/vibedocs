import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { createAppState } from '../src/app-state.js'
import { toProjectRelativePath } from '../src/discovery.js'
import { projectNameFromConfigPath } from '../src/site-config-cache.js'
import type { FsEvent, FsEventListener, FsEventSource } from '../src/ports/fs-event-source.js'
import type { ClientChannel } from '../src/ports/client-channel.js'
import type { WsMessage } from '../src/shared/ws-messages.js'
import { parseUploadAuthConfig } from '../src/upload-auth.js'

/**
 * AppState over more than one root (#113), driven through the in-memory ports the
 * ADR provides so file events are synchronous and assertable.
 *
 * What matters here is the two places a root leaks into something a client sees:
 * the project-relative path a reload message carries, and the project name the
 * site-config cache derives from a config-file path. Both were single-root string
 * arithmetic. Getting either wrong is silent — a reload for a project the frontend
 * cannot match, or a config that never invalidates.
 */
let tmp: string
let one: string
let two: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-appstate-multi-'))
  one = path.join(tmp, 'RootOne')
  two = path.join(tmp, 'RootTwo')
  await mkdir(one, { recursive: true })
  await mkdir(two, { recursive: true })
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function doc(root: string, project: string, file: string, body = '# doc') {
  const dir = path.join(root, project)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, file), body)
  return path.join(dir, file)
}

function fakeSource() {
  const listeners: FsEventListener[] = []
  return {
    source: {
      subscribe: (l: FsEventListener) => listeners.push(l),
      close: async () => {},
    } satisfies FsEventSource,
    emit: (event: FsEvent) => listeners.forEach((l) => l(event)),
  }
}

function recorder() {
  const sent: WsMessage[] = []
  return { sent, channel: { broadcast: (m: WsMessage) => sent.push(m), close: () => {} } satisfies ClientChannel }
}

describe('toProjectRelativePath across roots', () => {
  it('maps a path in any root to its project-relative wire form', () => {
    expect(toProjectRelativePath(path.join(one, 'alpha', 'a.md'), [one, two])).toBe('alpha/a.md')
    expect(toProjectRelativePath(path.join(two, 'beta', 'b.md'), [one, two])).toBe('beta/b.md')
  })

  it('uses the qualified project name when an earlier root shadows it', async () => {
    // The frontend matches this string against the project it has open, so it has
    // to be the same name the project list used.
    await mkdir(path.join(one, 'shared'), { recursive: true })
    expect(toProjectRelativePath(path.join(two, 'shared', 'a.md'), [one, two])).toBe('shared~RootTwo/a.md')
  })

  it('returns null for a path under no root, so nothing absolute goes on the wire', () => {
    expect(toProjectRelativePath(path.join(tmp, 'elsewhere', 'a.md'), [one, two])).toBeNull()
    expect(toProjectRelativePath(one, [one, two])).toBeNull()
  })

  it('still takes a single root as a string', () => {
    expect(toProjectRelativePath(path.join(one, 'alpha', 'a.md'), one)).toBe('alpha/a.md')
  })
})

describe('projectNameFromConfigPath across roots', () => {
  it('finds the project in whichever root holds the config file', () => {
    expect(projectNameFromConfigPath(path.join(two, 'beta', '.vibedocs.config.ts'), [one, two])).toBe('beta')
  })

  it('uses the qualified name for a shadowed project', async () => {
    await mkdir(path.join(one, 'shared'), { recursive: true })
    expect(projectNameFromConfigPath(path.join(two, 'shared', '.vibedocs.config.ts'), [one, two]))
      .toBe('shared~RootTwo')
  })

  it('ignores a config file that is not a direct child of a project', () => {
    expect(projectNameFromConfigPath(path.join(two, '.vibedocs.config.ts'), [one, two])).toBeNull()
    expect(projectNameFromConfigPath(path.join(two, 'beta', 'deep', '.vibedocs.config.ts'), [one, two])).toBeNull()
  })

  it('still takes a single root as a string', () => {
    expect(projectNameFromConfigPath(path.join(one, 'alpha', '.vibedocs.config.ts'), one)).toBe('alpha')
  })
})

describe('createAppState with several roots', () => {
  const build = (roots: string[], fs: FsEventSource, channel: ClientChannel) =>
    createAppState({
      roots,
      fsEventSource: fs,
      clientChannel: channel,
      uploadAuth: parseUploadAuthConfig({}),
      searchRebuildDelayMs: 1,
    })

  it('lists projects from every root', async () => {
    await doc(one, 'alpha', 'a.md')
    await doc(two, 'beta', 'b.md')
    const { source } = fakeSource()
    const { channel } = recorder()

    const state = build([one, two], source, channel)
    await state.start()
    try {
      expect((await state.listProjects()).map((p) => p.name).sort()).toEqual(['alpha', 'beta'])
    } finally {
      await state.shutdown()
    }
  })

  it('searches across every root once started', async () => {
    await doc(one, 'alpha', 'a.md', 'needle one')
    await doc(two, 'beta', 'b.md', 'needle two')
    const { source } = fakeSource()
    const { channel } = recorder()

    const state = build([one, two], source, channel)
    await state.start()
    try {
      await state.settleSearchIndex()
      expect(state.search('needle').map((r) => r.project).sort()).toEqual(['alpha', 'beta'])
    } finally {
      await state.shutdown()
    }
  })

  it('broadcasts a reload naming the project, for a change in a later root', async () => {
    const target = await doc(two, 'beta', 'b.md')
    const { source, emit } = fakeSource()
    const { sent, channel } = recorder()

    const state = build([one, two], source, channel)
    await state.start()
    try {
      emit({ kind: 'change', path: target })
      const reload = sent.find((m) => m.type === 'reload')
      expect(reload).toMatchObject({ type: 'reload', path: 'beta/b.md' })
    } finally {
      await state.shutdown()
    }
  })

  it('invalidates the site-config cache for a project in a later root', async () => {
    await doc(two, 'beta', 'b.md')
    const configPath = path.join(two, 'beta', '.vibedocs.config.ts')
    await writeFile(configPath, 'export default {}')
    const { source, emit } = fakeSource()
    const { channel } = recorder()

    const state = build([one, two], source, channel)
    await state.start()
    try {
      await state.listProjects() // populates the cache
      expect(state.siteConfigCacheHas('beta')).toBe(true)

      emit({ kind: 'change', path: configPath })
      expect(state.siteConfigCacheHas('beta')).toBe(false)
    } finally {
      await state.shutdown()
    }
  })

  it('still accepts a single projectsDir, which is what runLive passes today', async () => {
    await doc(one, 'alpha', 'a.md')
    const { source } = fakeSource()
    const { channel } = recorder()

    const state = createAppState({
      projectsDir: one,
      fsEventSource: source,
      clientChannel: channel,
      uploadAuth: parseUploadAuthConfig({}),
      searchRebuildDelayMs: 1,
    })
    await state.start()
    try {
      expect((await state.listProjects()).map((p) => p.name)).toEqual(['alpha'])
    } finally {
      await state.shutdown()
    }
  })
})
