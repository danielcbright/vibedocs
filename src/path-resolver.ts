import path from 'path'
import { VibedocsError } from './errors.js'
import { EXCLUDED_DIRS } from './discovery.js'

/**
 * Branded type for filesystem paths that have been validated by a PathResolver.
 *
 * Downstream filesystem calls should accept `SafePath` rather than raw `string`
 * so that any code path that bypasses validation fails at compile time.
 */
export type SafePath = string & { readonly __brand: 'SafePath' }

export interface PathResolverOptions {
  projectsDir: string
  /**
   * If set, the resolved path must end with one of these (case-sensitive)
   * extensions. Use for narrowing a resolver to a specific file type, e.g.
   * markdown-only document routes.
   */
  requireExtensions?: readonly string[]
}

/**
 * Resolve user-supplied relative paths inside a project root with traversal
 * defense. On success returns a `SafePath`; on failure throws `VibedocsError`
 * with a typed `code` discriminator.
 */
export class PathResolver {
  private readonly projectsDir: string
  private readonly requireExtensions?: readonly string[]

  constructor(opts: PathResolverOptions) {
    this.projectsDir = path.resolve(opts.projectsDir)
    this.requireExtensions = opts.requireExtensions
  }

  resolve(project: string, relativePath: string): SafePath {
    const projectDir = path.resolve(this.projectsDir, project)

    // Layer 1: project name must not escape the projects root.
    if (!isWithin(projectDir, this.projectsDir)) {
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
}

/** True when `target` equals `root` or sits inside it. Both must be absolute. */
function isWithin(target: string, root: string): boolean {
  return target === root || target.startsWith(root + path.sep)
}
