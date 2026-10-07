import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, mkdtemp, writeFile, readFile, realpath } from 'fs/promises'
import path from 'path'
import os from 'os'
import { parsePickRootsArgs, runPickRoots, SETUP_TOKEN_HEADER } from '../src/cli/pick-roots.js'
import { parseRootsFile } from '../src/project-roots.js'

/**
 * `vibedocs pick-roots` — the one-shot install page.
 *
 * Driven over a real socket, as the installer runs it: the picker must hand back
 * a nested selection in the roots file and exit 0, and refuse anything that does
 * not carry the token it printed.
 */
describe('parsePickRootsArgs', () => {
  it('requires --write and resolves it', () => {
    expect(parsePickRootsArgs(['--write', 'roots'], '/cfg')).toEqual({ write: '/cfg/roots', port: 0 })
    expect(() => parsePickRootsArgs([], '/cfg')).toThrow(/--write/)
    expect(() => parsePickRootsArgs(['--write', 'r', '--port', 'x'], '/cfg')).toThrow(/--port/)
    expect(() => parsePickRootsArgs(['--write', 'r', '--folders', 'a'], '/cfg')).toThrow(/unknown flag/)
  })
})

describe('runPickRoots', () => {
  let tmp: string
  let home: string
  let dist: string
  let rootsFile: string

  beforeEach(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vibedocs-pick-')))
    home = path.join(tmp, 'home')
    dist = path.join(tmp, 'dist')
    rootsFile = path.join(tmp, 'vibedocs', 'roots')
    for (const f of ['src/eg/repo/README.md', 'src/personal/site/README.md', 'ops/runbook.md']) {
      await mkdir(path.dirname(path.join(home, f)), { recursive: true })
      await writeFile(path.join(home, f), '# x')
    }
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>picker</title>')
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  function start() {
    let out = ''
    let err = ''
    let resolveUrl!: (u: string) => void
    const launched = new Promise<string>((r) => (resolveUrl = r))
    const done = runPickRoots(
      { write: rootsFile, port: 0 },
      {
        launch: async (u) => resolveUrl(u),
        stdout: (s) => (out += s),
        stderr: (s) => (err += s),
        frontendDist: dist,
        home,
      },
    )
    return { launched, done, output: () => ({ out, err }) }
  }

  it('serves the picker, refuses calls without its token, and exits 0 once a nested selection is saved', async () => {
    const run = start()
    const url = new URL(await run.launched)
    expect(url.hostname).toBe('127.0.0.1')
    const token = url.searchParams.get('setup')!
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    const origin = url.origin
    const api = (p: string, init: RequestInit = {}, withToken = true) =>
      fetch(`${origin}${p}`, {
        ...init,
        headers: {
          ...(withToken ? { [SETUP_TOKEN_HEADER]: token } : {}),
          'Content-Type': 'application/json',
          Origin: origin,
          ...(init.headers as Record<string, string> | undefined),
        },
      })

    // The page itself is the built SPA.
    expect(await (await fetch(url)).text()).toContain('<title>picker</title>')

    expect((await api('/api/settings/roots', {}, false)).status).toBe(403)
    expect((await api('/api/settings/roots', { headers: { [SETUP_TOKEN_HEADER]: 'f'.repeat(32) } })).status).toBe(403)

    const settings = (await (await api('/api/settings/roots')).json()).data
    expect(settings).toMatchObject({ roots: [], editable: true, home, afterSave: 'done' })

    const listing = (await (await api(`/api/settings/folders?path=${encodeURIComponent(path.join(home, 'src'))}`)).json()).data
    expect(listing.folders.map((f: { name: string }) => f.name)).toEqual(['eg', 'personal'])

    const chosen = [path.join(home, 'src', 'eg'), path.join(home, 'ops')]
    const put = await api('/api/settings/roots', { method: 'PUT', body: JSON.stringify({ roots: chosen }) })
    expect(put.status).toBe(200)
    expect((await put.json()).data).toEqual({ roots: chosen, afterSave: 'done' })

    expect(await run.done).toBe(0)
    expect(parseRootsFile(await readFile(rootsFile, 'utf-8'))).toEqual({ ok: true, roots: chosen })
    expect(run.output().out).toMatch(/Saved 2 roots to/)
    // And the server is gone, so a stale tab cannot change anything later.
    await expect(fetch(`${origin}/api/settings/roots`)).rejects.toThrow()
  })

  it('starts from the roots file the installer already has', async () => {
    await mkdir(path.dirname(rootsFile), { recursive: true })
    await writeFile(rootsFile, `${path.join(home, 'ops')}\n`)
    const run = start()
    const url = new URL(await run.launched)
    const token = url.searchParams.get('setup')!
    const res = await fetch(`${url.origin}/api/settings/roots`, { headers: { [SETUP_TOKEN_HEADER]: token } })
    expect((await res.json()).data.roots).toEqual([path.join(home, 'ops')])
    // Finish the run so the server closes.
    await fetch(`${url.origin}/api/settings/roots`, {
      method: 'PUT',
      headers: { [SETUP_TOKEN_HEADER]: token, 'Content-Type': 'application/json', Origin: url.origin },
      body: JSON.stringify({ roots: [path.join(home, 'ops')] }),
    })
    expect(await run.done).toBe(0)
  })

  it('refuses to start without a built frontend', async () => {
    const code = await runPickRoots(
      { write: rootsFile, port: 0 },
      { launch: async () => {}, stdout: () => {}, stderr: () => {}, frontendDist: path.join(tmp, 'nope'), home },
    )
    expect(code).toBe(1)
  })
})
