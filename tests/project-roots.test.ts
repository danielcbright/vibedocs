import { describe, it, expect } from 'vitest'
import path from 'path'
import { parseRoots, projectNameFor, locateProject, resolveBuildRoot } from '../src/project-roots.js'

/**
 * Where projects are looked for. One root today, a colon-separated list with
 * `VIBEDOCS_ROOTS` (#113).
 *
 * Colon is POSIX-only on purpose — see the decisions recorded on #113. The
 * parser's job is to turn a hand-written env string into a list that the rest of
 * the server can trust: absolute, deduplicated, and free of the two arrangements
 * that are silently wrong rather than merely odd.
 */
describe('parseRoots', () => {
  const cwd = '/work'
  const parse = (env: Record<string, string | undefined>) => parseRoots(env, cwd)

  it('falls back to the working directory when nothing is set', () => {
    expect(parse({})).toEqual({ ok: true, roots: [cwd] })
  })

  it('keeps VIBEDOCS_ROOT working, because that is the documented single-root var', () => {
    expect(parse({ VIBEDOCS_ROOT: '/docs' })).toEqual({ ok: true, roots: ['/docs'] })
  })

  it('splits VIBEDOCS_ROOTS on colons', () => {
    const r = parse({ VIBEDOCS_ROOTS: '/a:/b:/c' })
    expect(r).toEqual({ ok: true, roots: ['/a', '/b', '/c'] })
  })

  it('lets VIBEDOCS_ROOTS win when both are set, and says that it did', () => {
    // Most-specific intent wins, but silently ignoring an exported variable is
    // how an operator spends an afternoon on the wrong theory.
    const r = parse({ VIBEDOCS_ROOTS: '/a:/b', VIBEDOCS_ROOT: '/single' })
    expect(r.roots).toEqual(['/a', '/b'])
    expect(r.notes?.join(' ')).toMatch(/VIBEDOCS_ROOT\b/)
  })

  it('drops empty entries, which would otherwise resolve to the whole cwd', () => {
    // `path.resolve('')` is the working directory, so a trailing colon would
    // quietly add an enormous root — the exact failure #113 opens with.
    expect(parse({ VIBEDOCS_ROOTS: '/a:' }).roots).toEqual(['/a'])
    expect(parse({ VIBEDOCS_ROOTS: ':/a::/b:' }).roots).toEqual(['/a', '/b'])
  })

  it('tolerates the whitespace a hand-written list picks up', () => {
    expect(parse({ VIBEDOCS_ROOTS: ' /a : /b ' }).roots).toEqual(['/a', '/b'])
  })

  it('falls back when the list is set but contains nothing usable', () => {
    expect(parse({ VIBEDOCS_ROOTS: '' }).roots).toEqual([cwd])
    expect(parse({ VIBEDOCS_ROOTS: '  :  ' }).roots).toEqual([cwd])
  })

  it('resolves relative entries against the working directory', () => {
    expect(parse({ VIBEDOCS_ROOTS: 'notes:../shared' }).roots).toEqual([
      path.resolve(cwd, 'notes'),
      path.resolve(cwd, '../shared'),
    ])
  })

  it('strips a trailing slash, so the same root written two ways is one root', () => {
    expect(parse({ VIBEDOCS_ROOTS: '/a/:/a' }).roots).toEqual(['/a'])
  })

  it('rejects two roots that share a basename', () => {
    // The disambiguated name for a colliding project is `<name>@<rootBasename>`,
    // so two roots called `docs` make that name ambiguous. Better to say so at
    // startup than to serve one of two projects at random.
    const r = parse({ VIBEDOCS_ROOTS: '/x/docs:/y/docs' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/basename/i)
    expect(r.error).toContain('/x/docs')
    expect(r.error).toContain('/y/docs')
  })

  it('rejects a root nested inside another root', () => {
    // Every file under the inner root would be discovered twice under two
    // different names, and every event would fire twice.
    const r = parse({ VIBEDOCS_ROOTS: '/a:/a/b' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/nested|inside/i)
  })

  it('does not mistake a sibling with a shared prefix for a nested root', () => {
    // `/a/bc` starts with `/a/b` as a string but is not inside it.
    expect(parse({ VIBEDOCS_ROOTS: '/a/b:/a/bc' }).ok).toBe(true)
  })

  it('accepts a single root with no basename constraint at all', () => {
    // The single-root case must stay exactly as permissive as it is today.
    expect(parse({ VIBEDOCS_ROOT: '/' }).ok).toBe(true)
  })
})

/**
 * The name a project is known by, and getting from that name back to a directory.
 *
 * These two are each other's inverse and MUST agree. Discovery names projects;
 * the search index names them independently while walking; the path resolver has
 * to turn a name from a URL back into a directory. If any of the three disagreed,
 * a search result would link to a project that 404s — with no error anywhere
 * saying why.
 *
 * Both take `dirExists` rather than touching the filesystem, so the rule is
 * testable in isolation and the resolver stays a stateless allocation.
 */
describe('projectNameFor / locateProject', () => {
  const roots = ['/first', '/second', '/third']
  /** Only `/first/docs` and `/second/docs` exist; every root has its own `solo`. */
  const dirExists = (p: string) =>
    ['/first/docs', '/second/docs', '/first/only-first', '/second/only-second', '/third/docs'].includes(p)

  const nameOf = (dir: string) => projectNameFor(roots, dir, dirExists)
  const locate = (project: string) => locateProject(roots, project, dirExists)

  it('leaves a project in the first root unqualified', () => {
    // The common case, and the one that must never change: adding a second root
    // must not rename anything, or every existing link breaks.
    expect(nameOf('/first/docs')).toBe('docs')
  })

  it('leaves a project unqualified when no earlier root offers that name', () => {
    expect(nameOf('/second/only-second')).toBe('only-second')
  })

  it('qualifies with the root basename when an earlier root has the same name', () => {
    expect(nameOf('/second/docs')).toBe('docs~second')
    expect(nameOf('/third/docs')).toBe('docs~third')
  })

  it('returns null for a directory under no configured root', () => {
    expect(nameOf('/elsewhere/docs')).toBeNull()
  })

  it('rounds-trips every name back to the directory it came from', () => {
    // The property that actually matters. Anything that breaks it turns a search
    // result into a 404.
    for (const dir of ['/first/docs', '/second/docs', '/third/docs', '/second/only-second']) {
      const name = nameOf(dir)!
      expect(locate(name), `round-trip of ${dir} via "${name}"`).toEqual({
        root: roots.find((r) => dir.startsWith(r + '/')),
        dir,
      })
    }
  })

  it('locates an unqualified name in the first root that has it', () => {
    expect(locate('docs')).toEqual({ root: '/first', dir: '/first/docs' })
    expect(locate('only-second')).toEqual({ root: '/second', dir: '/second/docs'.replace('docs', 'only-second') })
  })

  it('returns null for a name no root has', () => {
    expect(locate('nope')).toBeNull()
  })

  it('returns null when the qualifier names a root that is not configured', () => {
    // Otherwise a crafted name is a way to ask about a directory outside the roots.
    expect(locate('docs~nowhere')).toBeNull()
  })

  it('never lets a name escape its root, whatever it contains', () => {
    // The resolver applies its own containment check too; this is the first line.
    for (const hostile of ['..', '../..', 'a/../..', '..~second', '/etc']) {
      const found = locate(hostile)
      if (found !== null) {
        expect(found.dir.startsWith(found.root + '/')).toBe(true)
      }
    }
  })

  it('treats a literal @ in a folder name as part of the name when no root matches', () => {
    // A folder genuinely called `notes~home` must still be findable.
    const withLiteral = (p: string) => p === '/first/notes~home'
    expect(locateProject(roots, 'notes~home', withLiteral)).toEqual({
      root: '/first',
      dir: '/first/notes~home',
    })
    expect(projectNameFor(roots, '/first/notes~home', withLiteral)).toBe('notes~home')
  })

  it('splits on the last qualifier, so a literal @ before it still resolves', () => {
    const exists = (p: string) => p === '/second/a~b'
    expect(locateProject(roots, 'a~b~second', exists)).toEqual({
      root: '/second',
      dir: '/second/a~b',
    })
  })

  it('is a no-op for a single root, which is the whole installed base', () => {
    const one = ['/only']
    const has = (p: string) => p === '/only/docs'
    expect(projectNameFor(one, '/only/docs', has)).toBe('docs')
    expect(locateProject(one, 'docs', has)).toEqual({ root: '/only', dir: '/only/docs' })
  })
})

/**
 * `vibedocs build` renders ONE named project, so it is inherently single-root —
 * but it must not be blind to a project that lives in a later root just because
 * `VIBEDOCS_ROOTS` is what the operator exported.
 */
describe('resolveBuildRoot', () => {
  const roots = ['/first', '/second']
  const dirExists = (p: string) => ['/first/alpha', '/second/beta'].includes(p)

  it('returns the root that holds the named project', () => {
    expect(resolveBuildRoot(roots, 'alpha', dirExists)).toBe('/first')
    expect(resolveBuildRoot(roots, 'beta', dirExists)).toBe('/second')
  })

  it('falls back to the first root when no root has it', () => {
    // The build's own "project not found" message is better than one from here,
    // and the cwd-basename fallback downstream still gets its chance.
    expect(resolveBuildRoot(roots, 'nope', dirExists)).toBe('/first')
  })

  it('resolves a qualified name to its root', () => {
    const shadowed = (p: string) => ['/first/shared', '/second/shared'].includes(p)
    expect(resolveBuildRoot(roots, 'shared~second', shadowed)).toBe('/second')
    expect(resolveBuildRoot(roots, 'shared', shadowed)).toBe('/first')
  })
})
