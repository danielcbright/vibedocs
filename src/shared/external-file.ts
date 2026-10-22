/**
 * A markdown file opened by absolute path, outside any project (#223).
 *
 * `/open?path=<abs>` sends a file the roots do not cover to `#/file<abs>`, e.g.
 * `#/file/Users/me/.claude/notes.md`. Like `#/runs` and `#/settings` it lives in
 * the empty-project namespace, which no directory can claim. The frontend hands
 * the file to the API under `EXTERNAL_PROJECT`, a project name no directory can
 * have (it contains a slash), so `renderDoc`/`getRawDoc` can route it to
 * `/api/external/*` without a second hook.
 */
export const EXTERNAL_FILE_HASH_PREFIX = '/file'

/** Stands in for the project of an external file on the client's API seam. */
export const EXTERNAL_PROJECT = '/file'

/**
 * The absolute path carried by a hash path of the form `file/Users/...`, or null
 * when the hash path is not one. Percent-decodes, since the browser stores the
 * fragment encoded.
 */
export function externalPathFromHashPath(hashPath: string | null): string | null {
  if (hashPath === null) return null
  const prefix = EXTERNAL_FILE_HASH_PREFIX.slice(1) + '/'
  if (!hashPath.startsWith(prefix)) return null
  try {
    return '/' + decodeURIComponent(hashPath.slice(prefix.length))
  } catch {
    return null
  }
}
