import type { Context } from 'hono'
import { VibedocsError } from './errors.js'
import type { PathResolver, SafePath } from './path-resolver.js'

/**
 * Pre-resolver path extraction shared by /api/render, /api/raw, /api/file,
 * and /api/upload. These routes all need the same incantation:
 *
 *   1. Read the `:project` route param.
 *   2. Slice the trailing wildcard from the raw URL pathname (rather than
 *      `c.req.param('*')`) because the param value loses percent-encoding
 *      semantics for some Hono versions/configs.
 *   3. `decodeURIComponent` the sliced tail so resolvers receive on-disk
 *      filenames (e.g. "folder name/My Doc.md" not "folder%20name/My%20Doc.md").
 *
 * If the URL pathname does not match the expected prefix (proxy rewrites,
 * unusual base), fall back to the wildcard route param so we still hand the
 * resolver *something* rather than crashing on a bad string slice.
 *
 * The PathResolver's traversal-defense invariant is unchanged — that lives
 * entirely in src/path-resolver.ts. This helper is pure URL parsing.
 */
export function extractProjectPath(
  c: Context,
  routeBase: string,
): { project: string; relativePath: string } {
  const project = c.req.param('project') ?? ''
  const fullPath = new URL(c.req.url).pathname
  const prefix = `${routeBase}/${encodeURIComponent(project)}/`
  const relativePath = fullPath.startsWith(prefix)
    ? decodeURIComponent(fullPath.slice(prefix.length))
    : (c.req.param('*') ?? '')
  return { project, relativePath }
}

/**
 * Convenience wrapper that combines `extractProjectPath` with a `PathResolver`
 * call — the full pre-FS incantation that the four file-serving routes used
 * to inline. Throws `VibedocsError('invalid', 'Missing project or path')`
 * when either piece is empty (the central error handler translates that to
 * the same 400 the inline routes used to return).
 */
export function resolveProjectPath(
  c: Context,
  routeBase: string,
  resolver: PathResolver,
): SafePath {
  const { project, relativePath } = extractProjectPath(c, routeBase)
  if (!project || !relativePath) {
    throw new VibedocsError('invalid', 'Missing project or path')
  }
  return resolver.resolve(project, relativePath)
}
