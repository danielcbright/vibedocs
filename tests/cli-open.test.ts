import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, mkdtemp, writeFile, realpath } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { parseOpenArgs, runOpen, type OpenDeps } from '../src/cli/open.js'
import { registerOpenRoute } from '../src/open-route.js'
import { PathResolver } from '../src/path-resolver.js'
import { MARKDOWN_EXTENSIONS } from '../src/markdown-paths.js'

/**
 * `vibedocs open <path>` — the CLI side of `GET /open`.
 *
 * It asks the running server, then opens the browser only when the server
 * redirects, so a refusal is a message on stderr and a non-zero exit rather
 * than a browser tab onto an error page.
 */
describe('parseOpenArgs', () => {
  it('takes one path, resolved against the working directory', () => {
    expect(parseOpenArgs(['README.md'], {}, '/work').path).toBe('/work/README.md')
    expect(parseOpenArgs(['/abs/doc.md'], {}, '/work').path).toBe('/abs/doc.md')
  })

  it('defaults the port the way the server does: VIBEDOCS_PORT, then PORT, then 8080', () => {
    expect(parseOpenArgs(['a.md'], {}, '/w').port).toBe(8080)
    expect(parseOpenArgs(['a.md'], { PORT: '9000' }, '/w').port).toBe(9000)
    expect(parseOpenArgs(['a.md'], { PORT: '9000', VIBEDOCS_PORT: '9100' }, '/w').port).toBe(9100)
  })

  it('takes --port before or after the path', () => {
    expect(parseOpenArgs(['--port', '8091', 'a.md'], {}, '/w')).toEqual({ path: '/w/a.md', port: 8091 })
    expect(parseOpenArgs(['a.md', '--port', '8091'], {}, '/w')).toEqual({ path: '/w/a.md', port: 8091 })
  })

  it('refuses a missing path, a second path, an unknown flag and a bad port', () => {
    expect(() => parseOpenArgs([], {}, '/w')).toThrow(/path/)
    expect(() => parseOpenArgs(['a.md', 'b.md'], {}, '/w')).toThrow(/one path/)
    expect(() => parseOpenArgs(['a.md', '--host', 'x'], {}, '/w')).toThrow(/unknown flag/)
    expect(() => parseOpenArgs(['a.md', '--port', 'eighty'], {}, '/w')).toThrow(/--port/)
    expect(() => parseOpenArgs(['a.md', '--port'], {}, '/w')).toThrow(/--port/)
  })
})

describe('runOpen against the real route', () => {
  let tmp: string
  let root: string
  let launched: string[]
  let out: string
  let err: string

  beforeEach(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vibedocs-cli-open-')))
    root = path.join(tmp, 'root')
    await mkdir(path.join(root, 'proj', 'docs'), { recursive: true })
    await writeFile(path.join(root, 'proj', 'docs', 'guide.md'), '# Guide')
    await writeFile(path.join(root, 'proj', 'A doc + more.md'), '# Plus')
    await writeFile(path.join(root, 'proj', 'logo.png'), 'png')
    launched = []
    out = ''
    err = ''
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  function deps(overrides: Partial<OpenDeps> = {}): OpenDeps {
    const app = new Hono()
    registerOpenRoute(app, {
      roots: [root],
      docResolver: new PathResolver({ roots: [root], requireExtensions: MARKDOWN_EXTENSIONS }),
    })
    return {
      // Hono's in-process request takes a full URL, so the CLI's real URL goes
      // straight through the real route.
      fetch: (url, init) => Promise.resolve(app.request(String(url), init)),
      launch: async (url) => {
        launched.push(url)
      },
      stdout: (s) => {
        out += s
      },
      stderr: (s) => {
        err += s
      },
      ...overrides,
    }
  }

  it('opens the doc it was redirected to and exits 0', async () => {
    const code = await runOpen({ path: path.join(root, 'proj', 'docs', 'guide.md'), port: 8091 }, deps())
    expect(code).toBe(0)
    expect(launched).toEqual(['http://localhost:8091/#proj/docs/guide.md'])
    expect(err).toBe('')
  })

  it('encodes the path so spaces and a literal + survive the query string', async () => {
    const code = await runOpen({ path: path.join(root, 'proj', 'A doc + more.md'), port: 8091 }, deps())
    expect(code).toBe(0)
    expect(launched).toEqual(['http://localhost:8091/#proj/A%20doc%20+%20more.md'])
  })

  it('prints the server\'s reason and opens nothing when the server refuses', async () => {
    const code = await runOpen({ path: path.join(root, 'proj', 'logo.png'), port: 8091 }, deps())
    expect(code).toBe(1)
    expect(launched).toEqual([])
    expect(err).toMatch(/vibedocs open: .*is not a markdown file/)
  })

  it('says nothing is answering, and how to fix it, when no server is running', async () => {
    const code = await runOpen(
      { path: path.join(root, 'proj', 'docs', 'guide.md'), port: 8091 },
      deps({ fetch: () => Promise.reject(new TypeError('fetch failed')) }),
    )
    expect(code).toBe(1)
    expect(launched).toEqual([])
    expect(err).toMatch(/nothing is answering on http:\/\/localhost:8091/)
    expect(err).toMatch(/vibedocs serve/)
  })

  it('reports a server that answers but is not vibedocs, rather than opening it', async () => {
    const code = await runOpen(
      { path: path.join(root, 'proj', 'docs', 'guide.md'), port: 8091 },
      deps({ fetch: () => Promise.resolve(new Response('<html>someone else</html>', { status: 200 })) }),
    )
    expect(code).toBe(1)
    expect(launched).toEqual([])
    expect(err).toMatch(/not a VibeDocs server|unexpected/i)
  })
})
