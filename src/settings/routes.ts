/**
 * `/api/settings/*` — choose roots from the browser.
 *
 * Two hosts register these same routes: the live server (Settings view) and the
 * one-shot install page (`vibedocs pick-roots`). They differ only in what happens
 * after a save, which the host passes in as `afterSave` + `onSaved`.
 *
 *   GET  /api/settings/roots          current roots, whether they are editable here
 *   GET  /api/settings/folders?path=  child folders of one folder under home
 *   POST /api/settings/roots/check    the server's verdict on a proposed selection
 *   PUT  /api/settings/roots          check, write the roots file, then onSaved
 *
 * Every route is registered whatever the config, and answers 404 when the feature
 * is off: an unregistered path would fall through to the SPA fallback and answer
 * 200 text/html, which looks like success to a client checking `res.ok`.
 */
import type { Context, Hono } from 'hono'
import type { RootsSource } from '../project-roots.js'
import type { AfterSave, RootsSettings, RootsSaved } from '../shared/settings-types.js'
import { checkSettingsAuth } from './auth.js'
import { listFolders } from './folders.js'
import { checkSelection, readRootsFile, writeRootsFile } from './selection.js'

export interface SettingsRoutesDeps {
  enabled: boolean
  /** Port this server listens on; a function because the one-shot host binds port 0. */
  port: () => number
  /** Socket peer address of the request. */
  peerAddress: (c: Context) => string | undefined
  /** Top of the folder tree. */
  home: string
  /** Roots this process is serving. */
  roots: readonly string[]
  /** Which variable the roots came from. Only a roots file is editable. */
  source: RootsSource
  /** The roots file, resolved, when `source` is a file. */
  rootsFile: string | null
  afterSave: AfterSave
  /** Runs after a save has been written and its response built. */
  onSaved: (roots: string[]) => void
}

export function registerSettingsRoutes(app: Hono, deps: SettingsRoutesDeps): void {
  app.use('/api/settings/*', async (c, next) => {
    const verdict = checkSettingsAuth({
      enabled: deps.enabled,
      method: c.req.method,
      peerAddress: deps.peerAddress(c),
      host: c.req.header('host'),
      origin: c.req.header('origin'),
      port: deps.port(),
    })
    if (verdict === 'disabled') return c.json({ error: 'Not found' }, 404)
    if (verdict === 'not-local') return c.json({ error: 'Settings can only be changed from this machine.' }, 403)
    await next()
  })

  const editable = deps.source.kind === 'file' && deps.rootsFile !== null

  app.get('/api/settings/roots', async (c) => {
    const body: RootsSettings = {
      roots: [...deps.roots],
      saved: deps.rootsFile !== null ? await readRootsFile(deps.rootsFile) : null,
      editable,
      reason: editable ? null : notEditableReason(deps.source),
      home: deps.home,
      afterSave: deps.afterSave,
    }
    return c.json({ data: body })
  })

  app.get('/api/settings/folders', async (c) => {
    return c.json({ data: await listFolders(c.req.query('path') || deps.home, deps.home) })
  })

  app.post('/api/settings/roots/check', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { roots?: unknown } | null
    return c.json({ data: await checkSelection(body?.roots) })
  })

  app.put('/api/settings/roots', async (c) => {
    if (!editable) return c.json({ error: notEditableReason(deps.source) }, 409)
    const body = (await c.req.json().catch(() => null)) as { roots?: unknown } | null
    const check = await checkSelection(body?.roots)
    if (!check.ok) return c.json({ error: check.error }, 400)

    await writeRootsFile(deps.rootsFile!, check.roots)
    const saved: RootsSaved = { roots: check.roots, afterSave: deps.afterSave }
    const res = c.json({ data: saved })
    deps.onSaved(check.roots)
    return res
  })

  app.all('/api/settings/*', (c) => c.json({ error: 'Not found' }, 404))
}

function notEditableReason(source: RootsSource): string {
  switch (source.kind) {
    case 'list':
      return 'Roots come from VIBEDOCS_ROOTS, which wins over a roots file. Unset it and set VIBEDOCS_ROOTS_FILE to choose roots here.'
    case 'single':
      return 'Roots come from VIBEDOCS_ROOT. Set VIBEDOCS_ROOTS_FILE to choose roots here.'
    case 'cwd':
      return 'VibeDocs is serving the folder it was started in. Set VIBEDOCS_ROOTS_FILE to choose roots here.'
    case 'file':
      return 'No roots file is configured.'
  }
}
