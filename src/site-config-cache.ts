// Per-project site-config cache.
//
// The /api/projects route inlines each project's parsed `.vibedocs.config.ts`
// (see issue #48 and spec decision #14). Re-running esbuild + dynamic-import on
// every poll would be wasteful, so we memoise per project name. The chokidar
// watcher in server.ts calls `invalidateFromPath` whenever a project's
// `.vibedocs.config.ts` changes, forcing the next /api/projects request to
// re-load that one project.
//
// Failure handling: a load error caches a `null` for the offending project so
// the rest of the projects-list response keeps working. The next invalidation
// retries the load (e.g. user fixes the syntax error and saves). The route
// stays alive when a single config is broken — matches the "default behaviour
// unchanged" guarantee in the issue spec.
//
// No ESM module-leak here: `loadSiteConfig` evaluates the esbuild-bundled
// config as CommonJS in a fresh `vm` context (see `evaluateBundledConfig` in
// site-config.ts) rather than dynamic-importing a temp file. That leaves no
// permanent entry in Node's ESM loader cache, so re-loading on every chokidar
// invalidation is safe to do indefinitely (fixed in issue #62).

import path from 'path'
import { statSync } from 'fs'
import { locateProject, projectNameFor } from './project-roots.js'
import type { SiteConfig } from './site-config.js'

const CONFIG_FILENAME = '.vibedocs.config.ts'

export interface SiteConfigCacheOptions {
  /** Loader, injectable so tests can run without touching the filesystem. */
  loadConfig: (projectPath: string) => Promise<SiteConfig | null>
  /** Absolute path of the directory that holds every project as a subfolder. */
  /** Single root, or every configured root in order (#113). */
  projectsDir: string | readonly string[]
}

export interface SiteConfigCache {
  /**
   * Return the cached SiteConfig (or null) for a project, loading + caching it
   * on first access. Load errors are caught and cached as null so the wider
   * /api/projects response stays alive when one project's config is broken.
   */
  get(projectName: string): Promise<SiteConfig | null>
  /** Force the next `get(name)` to re-load from disk. */
  invalidate(projectName: string): void
  /**
   * Given an absolute filesystem path to a `.vibedocs.config.ts`, map it back
   * to its project name (the directory under projectsDir) and invalidate that
   * entry. Silently ignores paths that don't sit directly under
   * `projectsDir/<project>/.vibedocs.config.ts` — chokidar must never crash
   * the watcher because of a path it can't classify.
   */
  invalidateFromPath(absPath: string): void
  /**
   * Test/diagnostics: returns true if `projectName` is currently memoised.
   */
  has(projectName: string): boolean
}

export function createSiteConfigCache(opts: SiteConfigCacheOptions): SiteConfigCache {
  const { loadConfig, projectsDir } = opts
  const roots = typeof projectsDir === 'string' ? [projectsDir] : projectsDir
  const cache = new Map<string, SiteConfig | null>()

  return {
    async get(projectName: string): Promise<SiteConfig | null> {
      if (cache.has(projectName)) {
        return cache.get(projectName) ?? null
      }
      // A lookup rather than a join, because with several roots the name may be
      // qualified and may not live in the first one. Falling back to a join keeps
      // the single-root path byte-identical to what it always did — the directory
      // does not have to exist for `loadConfig` to be asked about it, and callers
      // that stub `loadConfig` against paths on no filesystem still work.
      const projectPath =
        locateProject(roots, projectName, existsAsDir)?.dir ?? path.join(roots[0], projectName)
      try {
        const cfg = await loadConfig(projectPath)
        cache.set(projectName, cfg)
        return cfg
      } catch (err) {
        // Don't propagate — one broken config can't take down /api/projects.
        // Log so the operator notices; cache null so we don't re-try every
        // request. Next invalidation (file save) re-attempts the load.
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`  ⚠ siteConfig load failed for ${projectName}: ${msg}`)
        cache.set(projectName, null)
        return null
      }
    },

    invalidate(projectName: string): void {
      cache.delete(projectName)
    },

    invalidateFromPath(absPath: string): void {
      const name = projectNameFromConfigPath(absPath, projectsDir)
      if (name !== null) cache.delete(name)
    },

    has(projectName: string): boolean {
      return cache.has(projectName)
    },
  }
}

/**
 * Map an absolute config-file path back to its project name (the directory
 * immediately under projectsDir). Returns null when:
 *   - filename is not `.vibedocs.config.ts`
 *   - the file isn't nested under projectsDir
 *   - it sits more than one level deep under projectsDir (config file must
 *     live at the project root, not in a subdirectory)
 *
 * Exported only for testability — pure function, no side effects.
 */
export function projectNameFromConfigPath(
  absPath: string,
  projectsDir: string | readonly string[],
): string | null {
  if (path.basename(absPath) !== CONFIG_FILENAME) return null
  const roots = typeof projectsDir === 'string' ? [projectsDir] : projectsDir

  for (const root of roots) {
    const rel = path.relative(root, path.dirname(absPath))
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue
    // Must be a direct child of a root (single segment, no separators).
    if (rel.includes(path.sep)) return null
    // Same naming as the project list, or the invalidation targets a key the
    // cache never stored and the stale config survives.
    return projectNameFor(roots, path.join(root, rel), existsAsDir)
  }
  return null
}

/** Sync existence probe for `projectNameFor`. */
function existsAsDir(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory()
  } catch {
    return false
  }
}
