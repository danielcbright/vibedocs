import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, mkdtemp, writeFile } from 'fs/promises'
import path from 'path'
import os from 'os'
import { PathResolver } from '../src/path-resolver.js'
import { VibedocsError } from '../src/errors.js'

/**
 * The security boundary, over more than one root (#113).
 *
 * `projectsDir` becomes `roots`, and the project segment is no longer resolved by
 * string-joining onto one base — it is looked up. That is the part worth testing
 * hostilely: a lookup that can be steered is a way to read a directory outside
 * every root, and the whole point of this class is that it cannot be.
 */
let tmp: string
let one: string
let two: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-resolver-multi-'))
  one = path.join(tmp, 'RootOne')
  two = path.join(tmp, 'RootTwo')
  // `shared` exists in both; `alpha` and `beta` in one root each.
  await mkdir(path.join(one, 'alpha', 'docs'), { recursive: true })
  await mkdir(path.join(one, 'shared'), { recursive: true })
  await mkdir(path.join(two, 'beta'), { recursive: true })
  await mkdir(path.join(two, 'shared'), { recursive: true })
  await mkdir(path.join(tmp, 'outside'), { recursive: true })
  await writeFile(path.join(tmp, 'outside', 'secret.md'), 'no')
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const expectThrows = (fn: () => unknown, code: string) => {
  try {
    fn()
    throw new Error('expected throw')
  } catch (err) {
    expect(err).toBeInstanceOf(VibedocsError)
    expect((err as VibedocsError).code).toBe(code)
  }
}

describe('PathResolver with multiple roots', () => {
  const resolver = () => new PathResolver({ roots: [one, two] })

  it('finds a project in the first root', () => {
    expect(resolver().resolve('alpha', 'docs/guide.md') as unknown as string).toBe(
      path.join(one, 'alpha', 'docs', 'guide.md'),
    )
  })

  it('finds a project in a later root', () => {
    // The case a single-base string join cannot do: `beta` is not under root one.
    expect(resolver().resolve('beta', 'notes.md') as unknown as string).toBe(
      path.join(two, 'beta', 'notes.md'),
    )
  })

  it('gives the bare name to the first root when both have it', () => {
    expect(resolver().resolve('shared', 'a.md') as unknown as string).toBe(
      path.join(one, 'shared', 'a.md'),
    )
  })

  it('reaches the shadowed project through its qualified name', () => {
    expect(resolver().resolve('shared~RootTwo', 'a.md') as unknown as string).toBe(
      path.join(two, 'shared', 'a.md'),
    )
  })

  it('refuses a qualifier naming a root that is not configured', () => {
    // Otherwise the qualifier is an instruction the caller controls, and the
    // resolver would follow it out of the roots.
    expectThrows(() => resolver().resolve('shared~outside', 'a.md'), 'not-found')
    expectThrows(() => resolver().resolve('alpha~RootTwo', 'a.md'), 'not-found')
  })

  it('refuses a project name no root has', () => {
    expectThrows(() => resolver().resolve('nope', 'a.md'), 'not-found')
  })

  it('refuses to let the project segment escape any root', () => {
    for (const hostile of ['..', '../outside', '../../etc', '/etc', 'alpha/../../outside']) {
      expectThrows(() => resolver().resolve(hostile, 'secret.md'), 'not-found')
    }
  })

  it('still refuses a relative path that escapes its project', () => {
    // Layer 2 is unchanged, and must stay so for the root that was chosen by a
    // lookup rather than by a join.
    expectThrows(() => resolver().resolve('beta', '../alpha/docs/guide.md'), 'traversal')
    expectThrows(() => resolver().resolve('shared~RootTwo', `../../${path.basename(tmp)}/x.md`), 'traversal')
  })

  it('still refuses dot-directories and excluded directories under a later root', () => {
    // Layer 3 is unchanged. It has to apply to every root, not just the first.
    expectThrows(() => resolver().resolve('beta', '.git/config'), 'forbidden')
    expectThrows(() => resolver().resolve('beta', 'node_modules/pkg/index.md'), 'forbidden')
    expectThrows(() => resolver().resolve('shared~RootTwo', '.env'), 'forbidden')
  })

  it('still applies the extension allowlist across roots', () => {
    const md = new PathResolver({ roots: [one, two], requireExtensions: ['.md'] })
    expect(md.resolve('beta', 'notes.md') as unknown as string).toBe(path.join(two, 'beta', 'notes.md'))
    expectThrows(() => md.resolve('beta', 'notes.txt'), 'invalid')
  })
})

describe('PathResolver with one root', () => {
  /**
   * The installed base. Single-root behaviour has to be unchanged, including the
   * cases that used to depend on string-joining: a project directory that does not
   * exist still resolves, because the routes report not-found from the read.
   */
  it('accepts the single-root option name it has always taken', () => {
    const r = new PathResolver({ projectsDir: one })
    expect(r.resolve('alpha', 'docs/guide.md') as unknown as string).toBe(
      path.join(one, 'alpha', 'docs', 'guide.md'),
    )
  })

  it('resolves a project directory that is not there, leaving not-found to the read', () => {
    // Pre-existing behaviour: the resolver validates shape, the filesystem decides
    // existence. Tightening this to a lookup would turn some 404s into a different
    // error and change what routes report.
    const r = new PathResolver({ projectsDir: one })
    expect(r.resolve('ghost', 'a.md') as unknown as string).toBe(path.join(one, 'ghost', 'a.md'))
  })

  it('still refuses to escape the single root', () => {
    const r = new PathResolver({ projectsDir: one })
    expectThrows(() => r.resolve('../outside', 'secret.md'), 'traversal')
  })
})
