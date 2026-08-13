import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, mkdtemp, writeFile } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Context } from 'hono'
import { extractProjectPath, resolveProjectPath } from '../src/route-path.js'
import { PathResolver } from '../src/path-resolver.js'
import { VibedocsError } from '../src/errors.js'

// ── Minimal fake Hono Context ────────────────────────────────────────────────
//
// extractProjectPath only reads c.req.url and c.req.param(name). A fake context
// with just those surfaces is enough to drive the helper in isolation, without
// spinning up a full Hono app or app.request() round trip.

function fakeContext(url: string, params: Record<string, string>): Context {
  return {
    req: {
      url,
      param: (name: string) => params[name],
    },
  } as unknown as Context
}

describe('extractProjectPath', () => {
  it('extracts project and the trailing wildcard from the raw URL pathname', () => {
    const c = fakeContext(
      'http://localhost:8080/api/render/myproject/docs/guide.md',
      { project: 'myproject', '*': 'docs/guide.md' },
    )
    const result = extractProjectPath(c, '/api/render')
    expect(result).toEqual({ project: 'myproject', relativePath: 'docs/guide.md' })
  })

  it('decodes percent-encoded segments in the wildcard portion', () => {
    // Filename with a space → encoded as %20 in the URL; the helper must decode
    // so the resolver receives the on-disk filename.
    const c = fakeContext(
      'http://localhost:8080/api/render/myproject/folder%20name/My%20Doc.md',
      { project: 'myproject', '*': 'folder%20name/My%20Doc.md' },
    )
    const result = extractProjectPath(c, '/api/render')
    expect(result).toEqual({ project: 'myproject', relativePath: 'folder name/My Doc.md' })
  })

  it('returns an empty relativePath when the wildcard portion is empty', () => {
    // /api/render/myproject/ — trailing slash, no tail. Routes treat this as a
    // 400 "missing path"; the helper just reports what it saw.
    const c = fakeContext(
      'http://localhost:8080/api/render/myproject/',
      { project: 'myproject', '*': '' },
    )
    const result = extractProjectPath(c, '/api/render')
    expect(result).toEqual({ project: 'myproject', relativePath: '' })
  })

  it('falls back to the wildcard param when the URL pathname does not match the prefix', () => {
    // Defensive fallback — if Hono ever serves a request whose pathname starts
    // with an unexpected base (proxy rewrites, etc.) we still hand the resolver
    // *something* rather than crashing on a string slice.
    const c = fakeContext(
      'http://localhost:8080/something-else/myproject/docs/guide.md',
      { project: 'myproject', '*': 'docs/guide.md' },
    )
    const result = extractProjectPath(c, '/api/render')
    expect(result).toEqual({ project: 'myproject', relativePath: 'docs/guide.md' })
  })

  it('handles a percent-encoded project name in the URL slice (matches inline route behavior)', () => {
    // Inline routes call encodeURIComponent(project) when computing the prefix.
    // The helper must do the same so projects with %-encodable chars still match.
    const c = fakeContext(
      'http://localhost:8080/api/render/my%20project/docs/guide.md',
      { project: 'my project', '*': 'docs/guide.md' },
    )
    const result = extractProjectPath(c, '/api/render')
    expect(result).toEqual({ project: 'my project', relativePath: 'docs/guide.md' })
  })
})

/**
 * A project name whose characters `encodeURIComponent` would escape.
 *
 * These arrive un-escaped in practice: browsers leave `@`, `+`, `!` and `~` alone
 * in a path, and the frontend's hash route carries the project name verbatim. The
 * helper used to rebuild the expected prefix with `encodeURIComponent(project)`,
 * so the comparison failed and the relative path came back empty — a 400 "Missing
 * project or path" for a project that exists and is listed. Found while adding
 * multi-root support (#113), which needs a qualified name to survive this hop.
 */
describe('extractProjectPath with characters encodeURIComponent would escape', () => {
  for (const project of ['lit@eral', 'plus+name', 'bang!name', 'tilde~name']) {
    it(`reads the path for a project named "${project}" sent verbatim`, () => {
      // No `*` param on purpose: Hono does not reliably populate it for a
      // wildcard route, which is why this helper parses the URL at all. With the
      // fallback available the bug hides, because the fallback happens to be right.
      const c = fakeContext(
        `http://localhost:8080/api/render/${project}/docs/guide.md`,
        { project },
      )
      expect(extractProjectPath(c, '/api/render')).toEqual({
        project,
        relativePath: 'docs/guide.md',
      })
    })

    it(`reads the path for a project named "${project}" sent percent-encoded`, () => {
      // The frontend's api-client encodes it, so both spellings reach the server.
      const c = fakeContext(
        `http://localhost:8080/api/render/${encodeURIComponent(project)}/docs/guide.md`,
        { project },
      )
      expect(extractProjectPath(c, '/api/render')).toEqual({
        project,
        relativePath: 'docs/guide.md',
      })
    })
  }

  it('still decodes the tail, which is the reason this helper exists', () => {
    const c = fakeContext(
      'http://localhost:8080/api/render/a@b/folder%20name/My%20Doc.md',
      { project: 'a@b' },
    )
    expect(extractProjectPath(c, '/api/render').relativePath).toBe('folder name/My Doc.md')
  })
})

describe('resolveProjectPath', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-route-path-test-'))
    await mkdir(path.join(tmpDir, 'myproject', 'docs'), { recursive: true })
    await writeFile(path.join(tmpDir, 'myproject', 'docs', 'guide.md'), '# hi\n')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns the SafePath alongside project + relativePath when valid', () => {
    const c = fakeContext(
      'http://localhost:8080/api/render/myproject/docs/guide.md',
      { project: 'myproject', '*': 'docs/guide.md' },
    )
    const resolver = new PathResolver({ projectsDir: tmpDir })
    const result = resolveProjectPath(c, '/api/render', resolver)
    expect(result.project).toBe('myproject')
    expect(result.relativePath).toBe('docs/guide.md')
    expect(result.safePath as unknown as string).toBe(
      path.join(tmpDir, 'myproject', 'docs', 'guide.md'),
    )
  })

  it('throws VibedocsError(invalid) when relativePath is empty', () => {
    // Inline routes return c.json({error: 'Missing project or path'}, 400).
    // The helper throws VibedocsError(invalid) which the central error handler
    // translates to the same 400 — preserving the over-the-wire status.
    const c = fakeContext(
      'http://localhost:8080/api/render/myproject/',
      { project: 'myproject', '*': '' },
    )
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolveProjectPath(c, '/api/render', resolver)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('invalid')
    }
  })

  it('allows an empty relativePath when allowEmptyPath is set (upload-to-project-root case)', () => {
    // The /api/upload route accepts `/api/upload/myproject/` as "upload to
    // project root". Without allowEmptyPath this is a 400; with it set, the
    // helper resolves to the project root SafePath.
    const c = fakeContext(
      'http://localhost:8080/api/upload/myproject/',
      { project: 'myproject', '*': '' },
    )
    const resolver = new PathResolver({ projectsDir: tmpDir })
    const result = resolveProjectPath(c, '/api/upload', resolver, { allowEmptyPath: true })
    expect(result.project).toBe('myproject')
    expect(result.relativePath).toBe('')
    expect(result.safePath as unknown as string).toBe(path.join(tmpDir, 'myproject'))
  })

  it('propagates VibedocsError(traversal) from the resolver on .. paths', () => {
    // `..` spelled so it survives URL parsing. `new URL()` normalises a literal
    // `p/../escape.md` — and a percent-encoded `%2e%2e` — down to `escape.md`
    // before this helper ever sees it, so an encoded SLASH is what actually
    // delivers `..` to the resolver, and it must still be refused.
    const c = fakeContext(
      'http://localhost:8080/api/render/myproject/..%2fescape.md',
      { project: 'myproject' },
    )
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolveProjectPath(c, '/api/render', resolver)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('traversal')
    }
  })

  it('rejects a path that URL normalisation has already collapsed away', () => {
    // `/api/render/myproject/../escape.md` arrives as `/api/render/escape.md`, so
    // there is no path after the project segment at all. Refusing it as "missing"
    // is accurate; what matters is that it is refused rather than served.
    const c = fakeContext(
      'http://localhost:8080/api/render/myproject/../escape.md',
      { project: 'myproject' },
    )
    const resolver = new PathResolver({ projectsDir: tmpDir })
    expect(() => resolveProjectPath(c, '/api/render', resolver)).toThrow(VibedocsError)
  })
})
