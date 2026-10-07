import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, mkdtemp, writeFile, readFile, realpath } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { registerErrorHandler } from '../src/errors.js'
import { registerStaticRoutes } from '../src/static-files.js'
import { registerSettingsRoutes, type SettingsRoutesDeps } from '../src/settings/routes.js'
import { checkSettingsAuth, parseSettingsConfig } from '../src/settings/auth.js'
import { MARKDOWN_CAP } from '../src/settings/folders.js'

/**
 * `/api/settings/*` — the roots picker's API, shared by the Settings view and the
 * one-shot install page.
 *
 * The write repoints what the server exposes (a root of ~ serves every non-dot file
 * under it), so the gate is tested from each side an attacker could come from.
 */
const PORT = 8091
const LOCAL = { Host: `localhost:${PORT}`, Origin: `http://localhost:${PORT}` }

let tmp: string
let home: string
let rootsFile: string
let saved: string[][]

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vibedocs-settings-')))
  home = path.join(tmp, 'home')
  rootsFile = path.join(tmp, 'vibedocs', 'roots')
  saved = []
  const files = [
    'src/work/repo-a/README.md',
    'src/work/repo-a/docs/guide.md',
    'src/work/repo-b/README.md',
    'src/personal/vibedocs/README.md',
    'ops/runbook.md',
    'ops/.git/HEAD.md',
    'scratch/docs/notes.md',
    'Documents/private.md',
    'Library/state.md',
    'node_modules/pkg/README.md',
    '.ssh/notes.md',
    'empty/.keep',
  ]
  for (const f of files) {
    const full = path.join(home, f)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, '# x')
  }
  await mkdir(path.dirname(rootsFile), { recursive: true })
  await writeFile(rootsFile, `${path.join(home, 'ops')}\n`)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function appWith(overrides: Partial<SettingsRoutesDeps> = {}, peer = '127.0.0.1') {
  const app = new Hono()
  registerErrorHandler(app)
  registerSettingsRoutes(app, {
    enabled: true,
    port: () => PORT,
    peerAddress: () => peer,
    home,
    roots: [path.join(home, 'ops')],
    source: { kind: 'file', file: rootsFile },
    rootsFile,
    afterSave: 'restart',
    onSaved: (roots) => {
      saved.push(roots)
    },
    ...overrides,
  })
  return app
}

const put = (app: Hono, roots: unknown, headers: Record<string, string> = LOCAL) =>
  app.request('/api/settings/roots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ roots }),
  })

describe('GET /api/settings/roots', () => {
  it('reports the running roots, the saved file and that a file-backed config is editable', async () => {
    const res = await appWith().request('/api/settings/roots', { headers: LOCAL })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      roots: [path.join(home, 'ops')],
      saved: [path.join(home, 'ops')],
      editable: true,
      reason: null,
      home,
      afterSave: 'restart',
    })
  })

  it('is read-only, and says why, when VIBEDOCS_ROOTS decides the roots', async () => {
    const res = await appWith({ source: { kind: 'list' }, rootsFile: null }).request('/api/settings/roots', { headers: LOCAL })
    const { data } = await res.json()
    expect(data.editable).toBe(false)
    expect(data.saved).toBeNull()
    expect(data.reason).toMatch(/VIBEDOCS_ROOTS/)
  })
})

describe('GET /api/settings/folders', () => {
  it('lists home-level folders with markdown counts, hiding dot, excluded and library folders', async () => {
    const res = await appWith().request('/api/settings/folders', { headers: LOCAL })
    const { data } = await res.json()
    expect(data.path).toBe(home)
    expect(data.parent).toBeNull()
    expect(data.folders.map((f: { name: string }) => f.name)).toEqual(['Documents', 'empty', 'ops', 'scratch', 'src'])
    const byName = Object.fromEntries(data.folders.map((f: { name: string }) => [f.name, f]))
    expect(byName.src).toMatchObject({ path: path.join(home, 'src'), markdown: 4, capped: false, protected: false })
    // ops/.git is skipped, as discovery would.
    expect(byName.ops.markdown).toBe(1)
    expect(byName.empty.markdown).toBe(0)
  })

  it('flags privacy-protected folders and does not read inside them', async () => {
    const { data } = await (await appWith().request('/api/settings/folders', { headers: LOCAL })).json()
    const docs = data.folders.find((f: { name: string }) => f.name === 'Documents')
    expect(docs).toMatchObject({ protected: true, markdown: null })
  })

  it('lists a nested folder, with its parent, so the picker can descend', async () => {
    const res = await appWith().request(`/api/settings/folders?path=${encodeURIComponent(path.join(home, 'src'))}`, { headers: LOCAL })
    const { data } = await res.json()
    expect(data.parent).toBe(home)
    expect(data.folders.map((f: { name: string }) => [f.name, f.markdown])).toEqual([
      ['personal', 1],
      ['work', 3],
    ])
  })

  it('refuses a folder outside home, a hidden one, and a relative path', async () => {
    const app = appWith()
    const q = (p: string) => app.request(`/api/settings/folders?path=${encodeURIComponent(p)}`, { headers: LOCAL })
    expect((await q(tmp)).status).toBe(403)
    expect((await q(`${home}/src/../..`)).status).toBe(403)
    expect((await q(path.join(home, '.ssh'))).status).toBe(403)
    expect((await q(path.join(home, 'node_modules'))).status).toBe(403)
    expect((await q('src')).status).toBe(400)
  })

  it('marks a count that stopped at the depth limit as a lower bound', async () => {
    // Otherwise a parent could read fewer files than its own child: the child's
    // four levels reach one level further down.
    await mkdir(path.join(home, 'deep', 'a', 'b', 'c', 'd'), { recursive: true })
    await writeFile(path.join(home, 'deep', 'a', 'b', 'c', 'd', 'far.md'), 'x')
    await writeFile(path.join(home, 'deep', 'near.md'), 'x')
    const { data } = await (await appWith().request('/api/settings/folders', { headers: LOCAL })).json()
    expect(data.folders.find((f: { name: string }) => f.name === 'deep')).toMatchObject({ markdown: 1, capped: true })
  })

  it('caps a count instead of walking an enormous tree', async () => {
    const big = path.join(home, 'big', 'docs')
    await mkdir(big, { recursive: true })
    await Promise.all(Array.from({ length: MARKDOWN_CAP + 5 }, (_, i) => writeFile(path.join(big, `${i}.md`), 'x')))
    const { data } = await (await appWith().request('/api/settings/folders', { headers: LOCAL })).json()
    expect(data.folders.find((f: { name: string }) => f.name === 'big')).toMatchObject({ markdown: MARKDOWN_CAP, capped: true })
  })
})

describe('POST /api/settings/roots/check — the server\'s own verdict, before saving', () => {
  const check = (app: Hono, roots: unknown) =>
    app.request('/api/settings/roots/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...LOCAL },
      body: JSON.stringify({ roots }),
    })

  it('accepts nested folders below the top level of home', async () => {
    const roots = [path.join(home, 'src', 'work'), path.join(home, 'src', 'personal')]
    expect((await (await check(appWith(), roots)).json()).data).toEqual({ ok: true, roots })
  })

  it('returns the boot refusal for a parent and its child', async () => {
    const { data } = await (await check(appWith(), [path.join(home, 'src'), path.join(home, 'src', 'work')])).json()
    expect(data.ok).toBe(false)
    expect(data.error).toMatch(/nested/)
  })

  it('returns the boot refusal for two roots sharing a basename', async () => {
    await mkdir(path.join(home, 'src', 'scratch'), { recursive: true })
    const { data } = await (await check(appWith(), [path.join(home, 'scratch'), path.join(home, 'src', 'scratch')])).json()
    expect(data.error).toMatch(/basename/)
  })

  it('refuses an empty selection, a missing folder and a relative path', async () => {
    const app = appWith()
    expect((await (await check(app, [])).json()).data.error).toMatch(/at least one/)
    expect((await (await check(app, [path.join(home, 'gone')])).json()).data.error).toMatch(/does not exist/)
    expect((await (await check(app, ['src/work'])).json()).data.error).toMatch(/not an absolute path/)
    expect((await (await check(app, 'src')).json()).data.error).toMatch(/list of folder paths/)
  })
})

describe('PUT /api/settings/roots', () => {
  it('writes the roots file and then hands over to the host', async () => {
    const roots = [path.join(home, 'src', 'work'), path.join(home, 'src', 'personal'), path.join(home, 'ops')]
    const res = await put(appWith(), roots)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ roots, afterSave: 'restart' })
    expect(await readFile(rootsFile, 'utf-8')).toMatch(new RegExp(`${roots.join('\\n')}\\n$`))
    expect(saved).toEqual([roots])
  })

  it('leaves the file alone and does not hand over when the selection is refused', async () => {
    const before = await readFile(rootsFile, 'utf-8')
    const res = await put(appWith(), [path.join(home, 'src'), path.join(home, 'src', 'work')])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/nested/)
    expect(await readFile(rootsFile, 'utf-8')).toBe(before)
    expect(saved).toEqual([])
  })

  it('answers 409 when the roots do not come from a file', async () => {
    const res = await put(appWith({ source: { kind: 'list' }, rootsFile: null }), [path.join(home, 'ops')])
    expect(res.status).toBe(409)
    expect(saved).toEqual([])
  })
})

describe('the gate — this machine only', () => {
  it('404s every settings route when the feature is off, as JSON rather than the SPA fallback', async () => {
    const app = new Hono()
    const dist = path.join(tmp, 'dist')
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>spa</title>')
    registerSettingsRoutes(app, {
      enabled: false,
      port: () => PORT,
      peerAddress: () => '127.0.0.1',
      home,
      roots: [],
      source: { kind: 'file', file: rootsFile },
      rootsFile,
      afterSave: 'restart',
      onSaved: () => saved.push([]),
    })
    registerStaticRoutes(app, dist)
    for (const [method, url] of [
      ['GET', '/api/settings/roots'],
      ['GET', '/api/settings/folders'],
      ['POST', '/api/settings/roots/check'],
      ['PUT', '/api/settings/roots'],
      ['GET', '/api/settings/anything-else'],
    ] as const) {
      const res = await app.request(url, { method, headers: LOCAL })
      expect(res.status, `${method} ${url}`).toBe(404)
      expect(res.headers.get('content-type'), `${method} ${url}`).toMatch(/^application\/json/)
    }
    expect(saved).toEqual([])
  })

  it('403s another machine, whatever headers it sends', async () => {
    const res = await put(appWith({}, '192.168.1.20'), [path.join(home, 'ops')])
    expect(res.status).toBe(403)
    expect((await appWith({}, '100.64.0.7').request('/api/settings/folders', { headers: LOCAL })).status).toBe(403)
    expect(saved).toEqual([])
  })

  it('403s a DNS-rebinding page, which reaches loopback with its own Host', async () => {
    const res = await appWith().request('/api/settings/folders', { headers: { Host: `evil.example:${PORT}` } })
    expect(res.status).toBe(403)
  })

  it('403s a cross-site write that reaches localhost (CSRF)', async () => {
    const res = await put(appWith(), [path.join(home, 'ops')], { Host: `localhost:${PORT}`, Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    const none = await put(appWith(), [path.join(home, 'ops')], { Host: `localhost:${PORT}` })
    expect(none.status).toBe(403)
    expect(saved).toEqual([])
  })

  it('accepts IPv6 loopback and the IPv4-mapped form', async () => {
    expect((await appWith({}, '::1').request('/api/settings/roots', { headers: LOCAL })).status).toBe(200)
    expect((await appWith({}, '::ffff:127.0.0.1').request('/api/settings/roots', { headers: LOCAL })).status).toBe(200)
  })
})

describe('checkSettingsAuth / parseSettingsConfig', () => {
  const base = { enabled: true, method: 'PUT', peerAddress: '127.0.0.1', host: 'localhost:8080', origin: 'http://localhost:8080', port: 8080 }

  it('accepts the Vite dev server origin, which proxies /api with our Host', () => {
    expect(checkSettingsAuth({ ...base, origin: 'http://localhost:5173' })).toBe('ok')
  })

  it('does not accept another local port as the origin of a write', () => {
    expect(checkSettingsAuth({ ...base, origin: 'http://localhost:3000' })).toBe('not-local')
  })

  it('is off unless asked for, and read-only mode wins over asking', () => {
    expect(parseSettingsConfig({}, false).enabled).toBe(false)
    expect(parseSettingsConfig({ VIBEDOCS_SETTINGS_ENABLED: 'true' }, false).enabled).toBe(true)
    expect(parseSettingsConfig({ VIBEDOCS_SETTINGS_ENABLED: 'true' }, true).enabled).toBe(false)
    expect(parseSettingsConfig({ VIBEDOCS_SUPERVISED: '1' }, false).supervised).toBe(true)
  })
})
