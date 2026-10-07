import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, mkdtemp, writeFile, symlink, realpath } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { registerErrorHandler } from '../src/errors.js'
import { PathResolver } from '../src/path-resolver.js'
import { MARKDOWN_EXTENSIONS } from '../src/markdown-paths.js'
import { registerOpenRoute } from '../src/open-route.js'
import { registerStaticRoutes } from '../src/static-files.js'

/**
 * `GET /open?path=<absolute path>` — open a file by where it is on disk.
 *
 * The contract is fixed by a macOS `.md` handler app that calls
 * `http://localhost:8080/open?path=<url-encoded absolute path>`, so the route
 * name, the parameter name, and the redirect shape are all pinned here.
 */
let tmp: string
let one: string
let two: string
let outside: string

beforeEach(async () => {
  // realpath: macOS hands out /var/... for os.tmpdir(), which is a symlink to
  // /private/var/... — the symlinked-root test below wants to control that itself.
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vibedocs-open-')))
  one = path.join(tmp, 'RootOne')
  two = path.join(tmp, 'RootTwo')
  outside = path.join(tmp, 'outside')

  const files: Record<string, string> = {
    [path.join(one, 'alpha', 'docs', 'guide.md')]: '# Guide',
    [path.join(one, 'alpha', 'My Doc.md')]: '# Spaced',
    [path.join(one, 'alpha', 'ünïcode.md')]: '# Accented',
    [path.join(one, 'alpha', 'diagram.png')]: 'png',
    [path.join(one, 'alpha', '.hidden', 'secret.md')]: '# Hidden',
    [path.join(one, 'alpha', 'node_modules', 'pkg', 'README.md')]: '# Dep',
    [path.join(one, 'shared', 'README.md')]: '# One',
    [path.join(one, 'loose.md')]: '# Loose',
    [path.join(two, 'shared', 'notes.md')]: '# Two',
    [path.join(two, 'beta', 'README.md')]: '# Beta',
    [path.join(outside, 'secret.md')]: '# Outside',
  }
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, body)
  }
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function appFor(roots: readonly string[], opts: { withSpaFallback?: string } = {}) {
  const app = new Hono()
  registerErrorHandler(app)
  const docResolver = new PathResolver({ roots, requireExtensions: MARKDOWN_EXTENSIONS })
  registerOpenRoute(app, { roots, docResolver })
  if (opts.withSpaFallback) registerStaticRoutes(app, opts.withSpaFallback)
  return app
}

const open = (app: Hono, absPath: string) =>
  app.request(`/open?path=${encodeURIComponent(absPath)}`)

describe('GET /open — paths inside a root redirect to the hash route', () => {
  it('redirects a doc in the first root to /#<project>/<path>', async () => {
    const res = await open(appFor([one, two]), path.join(one, 'alpha', 'docs', 'guide.md'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/#alpha/docs/guide.md')
  })

  it('redirects a doc in a later root to its bare name when nothing shadows it', async () => {
    const res = await open(appFor([one, two]), path.join(two, 'beta', 'README.md'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/#beta/README.md')
  })

  it('uses the ~<rootBasename> qualifier for a shadowed project, exactly as the sidebar names it', async () => {
    const res = await open(appFor([one, two]), path.join(two, 'shared', 'notes.md'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/#shared~RootTwo/notes.md')
  })

  it('gives the first root the bare name for the same project', async () => {
    const res = await open(appFor([one, two]), path.join(one, 'shared', 'README.md'))
    expect(res.headers.get('location')).toBe('/#shared/README.md')
  })

  it('works with a single root', async () => {
    const res = await open(appFor([one]), path.join(one, 'alpha', 'docs', 'guide.md'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/#alpha/docs/guide.md')
  })

  it('percent-encodes spaces and non-ASCII the way a browser stores a fragment', async () => {
    // The Location header must be ASCII, and the sidebar's own navigation produces
    // the same %-encoded fragment once the browser has stored it.
    const app = appFor([one, two])
    const spaced = await open(app, path.join(one, 'alpha', 'My Doc.md'))
    expect(spaced.headers.get('location')).toBe('/#alpha/My%20Doc.md')
    const accented = await open(app, path.join(one, 'alpha', 'ünïcode.md'))
    expect(accented.headers.get('location')).toBe(`/#alpha/${encodeURIComponent('ünïcode.md')}`)
  })

  it('normalises a path whose .. segments stay inside the project', async () => {
    const res = await open(appFor([one, two]), `${one}/alpha/docs/../docs/./guide.md`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/#alpha/docs/guide.md')
  })

  it('finds a file through a root that is configured as a symlink', async () => {
    // A root can be a symlink if configured by hand, and the caller (Finder, or a
    // shell whose cwd is physical) hands over the resolved path.
    const link = path.join(tmp, 'LinkedRoot')
    await symlink(one, link)
    const res = await open(appFor([link]), path.join(one, 'alpha', 'docs', 'guide.md'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/#alpha/docs/guide.md')
  })

  it('still answers 302 with the SPA fallback registered after it', async () => {
    // The fallback answers ANY unmatched GET with 200 text/html, so a misordered
    // registration would look like success to anything checking res.ok.
    const dist = path.join(tmp, 'dist')
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>spa</title>')
    const res = await open(appFor([one, two], { withSpaFallback: dist }), path.join(one, 'alpha', 'docs', 'guide.md'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/#alpha/docs/guide.md')
  })
})

describe('GET /open — everything else is a readable page that says why', () => {
  const expectPage = async (res: Response, status: number, says: RegExp) => {
    expect(res.status).toBe(status)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(res.headers.get('location')).toBeNull()
    const body = await res.text()
    expect(body).toMatch(/^<!doctype html>/i)
    expect(body).toMatch(says)
    return body
  }

  it('404s a path outside every root', async () => {
    await expectPage(await open(appFor([one, two]), path.join(outside, 'secret.md')), 404, /not inside any folder VibeDocs indexes/)
  })

  it('answers an existing and a missing outside path identically, so it is not an existence oracle', async () => {
    const app = appFor([one, two])
    const exists = await (await open(app, path.join(outside, 'secret.md'))).text()
    const missing = await (await open(app, path.join(outside, 'nope.md'))).text()
    expect(exists.replace('secret.md', 'X')).toBe(missing.replace('nope.md', 'X'))
  })

  it('404s a .. traversal that escapes every root', async () => {
    const body = await expectPage(
      await open(appFor([one, two]), `${one}/alpha/../../outside/secret.md`),
      404,
      /not inside any folder VibeDocs indexes/,
    )
    expect(body).not.toContain('# Outside')
  })

  it('404s a missing file inside a project', async () => {
    await expectPage(await open(appFor([one, two]), path.join(one, 'alpha', 'nope.md')), 404, /no file at/)
  })

  it('404s a missing project in a later root', async () => {
    await expectPage(await open(appFor([one, two]), path.join(two, 'ghost', 'README.md')), 404, /no file at/)
  })

  it('404s a non-markdown asset', async () => {
    await expectPage(await open(appFor([one, two]), path.join(one, 'alpha', 'diagram.png')), 404, /not a markdown file/)
  })

  it('404s a folder', async () => {
    await expectPage(await open(appFor([one, two]), path.join(one, 'alpha', 'docs')), 404, /not a markdown file/)
  })

  it('404s a file under a dot-directory or an excluded directory, without saying whether it exists', async () => {
    const app = appFor([one, two])
    await expectPage(await open(app, path.join(one, 'alpha', '.hidden', 'secret.md')), 404, /hidden or excluded folder/)
    await expectPage(await open(app, path.join(one, 'alpha', '.hidden', 'nope.md')), 404, /hidden or excluded folder/)
    await expectPage(await open(app, path.join(one, 'alpha', 'node_modules', 'pkg', 'README.md')), 404, /hidden or excluded folder/)
  })

  it('404s a file sitting directly in a root, which belongs to no project', async () => {
    await expectPage(await open(appFor([one, two]), path.join(one, 'loose.md')), 404, /not inside a project folder/)
  })

  it('404s a root itself', async () => {
    await expectPage(await open(appFor([one, two]), one), 404, /not inside a project folder/)
  })

  it('400s a missing path parameter', async () => {
    await expectPage(await appFor([one, two]).request('/open'), 400, /absolute path/)
  })

  it('400s a relative path', async () => {
    await expectPage(await appFor([one, two]).request('/open?path=alpha%2FREADME.md'), 400, /not an absolute path/)
  })

  it('escapes the requested path, which is attacker-controlled', async () => {
    const body = await expectPage(
      await open(appFor([one, two]), '/tmp/<script>alert(1)</script>.md'),
      404,
      /not inside any folder/,
    )
    expect(body).not.toContain('<script>')
    expect(body).toContain('&lt;script&gt;')
  })

  it('serves the page with a CSP that allows no script, and nosniff', async () => {
    const res = await open(appFor([one, two]), path.join(outside, 'secret.md'))
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
