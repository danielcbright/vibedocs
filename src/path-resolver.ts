import path from 'path'
import { statSync } from 'fs'
import { VibedocsError } from './errors.js'
import { EXCLUDED_DIRS } from './excluded-paths.js'
import { locateProject } from './project-roots.js'

/**
 * Branded type for filesystem paths that have been validated by a PathResolver.
 *
 * Downstream filesystem calls should accept `SafePath` rather than raw `string`
 * so that any code path that bypasses validation fails at compile time.
 */
export type SafePath = string & { readonly __brand: 'SafePath' }

export type PathResolverOptions = {
  /**
   * If set, the resolved path must end with one of these (case-sensitive)
   * extensions. Use for narrowing a resolver to a specific file type, e.g.
   * markdown-only document routes.
   */
  requireExtensions?: readonly string[]
} & (
  | {
      /** The single directory holding every project. */
      projectsDir: string
      roots?: never
    }
  | {
      /** Every configured root, in order (#113). The first that has a project wins its bare name. */
      roots: readonly string[]
      projectsDir?: never
    }
)

/**
 * Resolve user-supplied relative paths inside a project root with traversal
 * defense. On success returns a `SafePath`; on failure throws `VibedocsError`
 * with a typed `code` discriminator.
 *
 * Stateless, and deliberately so — ADR-0001 keeps resolvers as module-level
 * allocations outside AppState. Multi-root does not change that: which root holds
 * a project is answered by `locateProject`, a pure function over the configured
 * roots plus a filesystem probe, rather than by a live registry that discovery
 * would have to keep up to date.
 */
export class PathResolver {
  private readonly roots: readonly string[]
  /**
   * One root resolves by joining, as it always has: the resolver validates shape
   * and the read decides existence. Keyed on the count rather than on which
   * option was passed, so `{ roots: [x] }` and `{ projectsDir: x }` cannot behave
   * differently — the composition root passes a list either way.
   */
  private readonly single: boolean
  private readonly requireExtensions?: readonly string[]

  constructor(opts: PathResolverOptions) {
    this.roots = (opts.projectsDir !== undefined ? [opts.projectsDir] : opts.roots).map((r) =>
      path.resolve(r),
    )
    this.single = this.roots.length === 1
    this.requireExtensions = opts.requireExtensions
  }

  resolve(project: string, relativePath: string): SafePath {
    const projectDir = this.resolveProjectDir(project)

    // Layer 1: the project directory must sit inside one of the configured roots.
    // With one root this is the original containment check; with several it also
    // covers the qualified-name lookup, so a crafted `name@root` cannot point
    // outside.
    const root = this.roots.find((r) => isWithin(projectDir, r))
    if (root === undefined) {
      throw new VibedocsError('traversal', 'Invalid path')
    }

    const target = relativePath
      ? path.resolve(projectDir, relativePath)
      : projectDir

    // Layer 2: resolved target must not escape the project directory.
    if (!isWithin(target, projectDir)) {
      throw new VibedocsError('traversal', 'Invalid path')
    }

    // Layer 3: reject dotfiles / dot-directories and EXCLUDED_DIRS at any path
    // segment under the project root. Discovery hides these (see discovery.ts),
    // and the file-serving routes must not become a backdoor that re-exposes
    // them (e.g. `.env`, `.git/config`, `node_modules/foo`).
    if (target !== projectDir) {
      const relUnderProject = path.relative(projectDir, target)
      const segments = relUnderProject.split(path.sep)
      for (const segment of segments) {
        if (segment.startsWith('.')) {
          throw new VibedocsError('forbidden', 'Forbidden path')
        }
        if (EXCLUDED_DIRS.has(segment)) {
          throw new VibedocsError('forbidden', 'Forbidden path')
        }
      }
    }

    // Optional layer: file-extension allowlist.
    if (this.requireExtensions && !this.requireExtensions.some((ext) => target.endsWith(ext))) {
      throw new VibedocsError('invalid', 'Invalid path')
    }

    return target as SafePath
  }

  /**
   * The directory a project name refers to.
   *
   * Single root: joined, exactly as before — the resolver validates shape and
   * leaves existence to the read, so a request for a project that isn't there
   * still 404s from the filesystem rather than from here.
   *
   * Several roots: looked up, because a join has no way to know which root holds
   * it. A name no root offers is `not-found` rather than a traversal error; it is
   * an ordinary miss, not an attack.
   */
  private resolveProjectDir(project: string): string {
    if (this.single) return path.resolve(this.roots[0], project)

    const found = locateProject(this.roots, project, isDirectorySync)
    if (found === null) throw new VibedocsError('not-found', `Project not found: ${project}`)
    return found.dir
  }
}

function isDirectorySync(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory()
  } catch {
    return false
  }
}

/** True when `target` equals `root` or sits inside it. Both must be absolute. */
function isWithin(target: string, root: string): boolean {
  return target === root || target.startsWith(root + path.sep)
}
