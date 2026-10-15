/**
 * `/api/external/*` — a markdown file by absolute path, outside every project.
 *
 * `/open?path=` used to refuse anything the roots did not cover. Now it sends
 * such a file to `#/file<abs>`, and these routes are what that view fetches:
 *
 *   GET /api/external/render?path=<abs>   rendered HTML + TOC
 *   GET /api/external/raw?path=<abs>      the markdown source (Copy button)
 *   GET /api/external/file?path=<abs>     an asset the file references
 *
 * This is deliberately NOT a project: nothing here is listed, watched, searched
 * or live-reloaded, and the PathResolver's root, dot-folder and excluded-folder
 * rules do not apply — the point is a file those rules would turn away, such as
 * a note under `~/.claude`.
 *
 * What does apply is `checkLocalOnly` (`src/settings/auth.ts`): loopback peer,
 * loopback Host, and for anything but GET our own Origin. Reading an arbitrary
 * file of the user's is fine for the user's own browser on this machine and for
 * no one else, so a remote caller is 403 whatever the bind address, and a
 * DNS-rebinding page fails on Host. Nothing is served to a non-markdown `path`
 * on the render and raw routes, and the asset route answers under the same
 * content-type policy as `/api/file`, so an HTML or SVG file downloads instead of
 * running in this origin.
 */
import type { Context, Hono } from 'hono'
import path from 'path'
import { checkLocalOnly } from './settings/auth.js'
import { VibedocsError } from './errors.js'
import { isMarkdownPath } from './markdown-paths.js'
import { renderSinglePage, type HtmlPage } from './render.js'
import type { SafePath } from './path-resolver.js'
import { fileResponse } from './server-routes.js'
import { readRawFile } from './app-state.js'
import { EXTERNAL_PROJECT } from './shared/external-file.js'

export interface ExternalFileRoutesDeps {
  port: () => number
  peerAddress: (c: Context) => string | undefined
  /** Injected so tests can stub the renderer; defaults to the real one. */
  render?: (absPath: string) => Promise<HtmlPage>
}

/** Where an asset referenced from an external file is fetched. */
export function externalAssetUrl(absPath: string): string {
  return `/api/external/file?path=${encodeURIComponent(absPath)}`
}

export async function renderExternalFile(absPath: string): Promise<HtmlPage> {
  // The rewriter resolves relative links against `currentDocPath` and refuses to
  // climb above its root; spelling the doc as the absolute path minus its leading
  // slash makes `/` that root, so `../img.png` lands on the right absolute path.
  try {
    return await renderSinglePage(absPath as SafePath, EXTERNAL_PROJECT, absPath.slice(1), 'live', {
      liveAssetUrl: (posixPath) => externalAssetUrl('/' + posixPath),
    })
  } catch (err: any) {
    if (err?.code === 'ENOENT') throw new VibedocsError('not-found', 'File not found', { cause: err })
    if (err?.code === 'EISDIR') throw new VibedocsError('invalid', 'Not a file', { cause: err })
    if (err?.code === 'EACCES' || err?.code === 'EPERM') throw new VibedocsError('forbidden', 'Permission denied', { cause: err })
    throw err
  }
}

export function registerExternalFileRoutes(app: Hono, deps: ExternalFileRoutesDeps): void {
  const render = deps.render ?? renderExternalFile

  app.use('/api/external/*', async (c, next) => {
    const verdict = checkLocalOnly({
      method: c.req.method,
      peerAddress: deps.peerAddress(c),
      host: c.req.header('host'),
      origin: c.req.header('origin'),
      port: deps.port(),
    })
    if (verdict === 'not-local') return c.json({ error: 'Files outside your roots can only be opened from this machine.' }, 403)
    await next()
  })

  app.get('/api/external/render', async (c) => {
    const abs = markdownPath(c.req.query('path'))
    const page = await render(abs)
    return c.json({ data: { html: page.html, toc: page.toc } })
  })

  app.get('/api/external/raw', async (c) => {
    const abs = markdownPath(c.req.query('path'))
    const content = await readRawFile(abs as SafePath)
    return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  })

  app.get('/api/external/file', async (c) => {
    return fileResponse(absolutePath(c.req.query('path')))
  })
}

function absolutePath(raw: string | undefined): string {
  if (!raw) throw new VibedocsError('invalid', 'Pass the absolute path of a file as ?path=')
  if (!path.isAbsolute(raw)) throw new VibedocsError('invalid', `“${raw}” is not an absolute path`)
  return path.resolve(raw)
}

function markdownPath(raw: string | undefined): string {
  const abs = absolutePath(raw)
  if (!isMarkdownPath(abs)) throw new VibedocsError('invalid', `“${abs}” is not a markdown file`)
  return abs
}
