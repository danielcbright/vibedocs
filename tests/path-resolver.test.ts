import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { PathResolver, type SafePath } from '../src/path-resolver.js'
import { VibedocsError } from '../src/errors.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-resolver-test-'))
  await mkdir(path.join(tmpDir, 'myproject', 'docs'), { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('PathResolver.resolve — valid paths', () => {
  it('returns a SafePath for a valid relative path inside the project', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    const result = resolver.resolve('myproject', 'docs/guide.md')
    expect(result as unknown as string).toBe(path.join(tmpDir, 'myproject', 'docs', 'guide.md'))
  })

  it('returns the project root when relativePath is empty', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    const result = resolver.resolve('myproject', '')
    expect(result as unknown as string).toBe(path.join(tmpDir, 'myproject'))
  })
})

describe('PathResolver.resolve — traversal defense', () => {
  it('throws VibedocsError(traversal) when relativePath escapes via ..', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolver.resolve('myproject', '../otherproject/secrets.md')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('traversal')
    }
  })

  it('throws VibedocsError(traversal) when the project name itself escapes via ..', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolver.resolve('../etc', 'passwd')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('traversal')
    }
  })

  it('throws VibedocsError(traversal) when relativePath is absolute', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolver.resolve('myproject', '/etc/passwd')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('traversal')
    }
  })
})

describe('PathResolver.resolve — extension restriction', () => {
  it('throws VibedocsError(invalid) when path does not match requireExtensions', () => {
    const resolver = new PathResolver({
      projectsDir: tmpDir,
      requireExtensions: ['.md', '.markdown'],
    })
    try {
      resolver.resolve('myproject', 'docs/image.png')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('invalid')
    }
  })

  it('accepts a path matching one of requireExtensions', () => {
    const resolver = new PathResolver({
      projectsDir: tmpDir,
      requireExtensions: ['.md', '.markdown'],
    })
    const result = resolver.resolve('myproject', 'docs/notes.markdown')
    expect(result as unknown as string).toBe(
      path.join(tmpDir, 'myproject', 'docs', 'notes.markdown')
    )
  })

  it('skips the extension check when requireExtensions is not configured', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    const result = resolver.resolve('myproject', 'docs/image.png')
    expect(result as unknown as string).toBe(
      path.join(tmpDir, 'myproject', 'docs', 'image.png')
    )
  })
})

describe('PathResolver.resolve — non-existent project', () => {
  // The resolver is path-math only; it must not touch the filesystem. Existence
  // is a separate concern owned by the route handlers (which translate ENOENT
  // into VibedocsError('not-found')). This pins the layering.
  it('returns a SafePath for a non-existent project (does not stat the FS)', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    const result = resolver.resolve('does-not-exist', 'whatever.md')
    expect(result as unknown as string).toBe(
      path.join(tmpDir, 'does-not-exist', 'whatever.md')
    )
  })
})

describe('PathResolver.resolve — dotfile / dot-directory rejection', () => {
  it('throws VibedocsError(forbidden) for a top-level dotfile like .env', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolver.resolve('myproject', '.env')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('forbidden')
    }
  })

  it('throws VibedocsError(forbidden) for a file inside a dot-directory like .git/config', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolver.resolve('myproject', '.git/config')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('forbidden')
    }
  })

  it('throws VibedocsError(forbidden) for a dotfile nested under a regular directory like subdir/.env', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolver.resolve('myproject', 'subdir/.env')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('forbidden')
    }
  })
})

describe('PathResolver.resolve — EXCLUDED_DIRS rejection', () => {
  it('throws VibedocsError(forbidden) for a file inside node_modules', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolver.resolve('myproject', 'node_modules/foo/bar.js')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('forbidden')
    }
  })

  it('throws VibedocsError(forbidden) for a file inside dist', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolver.resolve('myproject', 'dist/bundle.js')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('forbidden')
    }
  })

  it('throws VibedocsError(forbidden) when an EXCLUDED_DIR appears as an intermediate path segment', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    try {
      resolver.resolve('myproject', 'some/coverage/report.html')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('forbidden')
    }
  })

  it('accepts a regular path that touches neither dotfiles nor EXCLUDED_DIRS', () => {
    const resolver = new PathResolver({ projectsDir: tmpDir })
    const result = resolver.resolve('myproject', 'regular/file.md')
    expect(result as unknown as string).toBe(
      path.join(tmpDir, 'myproject', 'regular', 'file.md')
    )
  })
})

describe('PathResolver — SafePath branding', () => {
  it('SafePath narrows at the type level so raw strings cannot impersonate it', () => {
    // Compile-time check: a function that requires SafePath must reject raw strings.
    function takesSafePath(_p: SafePath): string {
      return _p
    }

    const resolver = new PathResolver({ projectsDir: tmpDir })
    const safe = resolver.resolve('myproject', 'docs/x.md')
    expect(takesSafePath(safe)).toBe(safe as unknown as string)

    // @ts-expect-error — raw string must NOT be assignable to SafePath
    takesSafePath('any-old-string')
  })
})
