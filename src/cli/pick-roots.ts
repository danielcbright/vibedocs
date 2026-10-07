// `vibedocs pick-roots --write <file>` — the one-shot install page.
//
// `scripts/install-macos.sh` runs this when it is not given `--folders`: a
// throwaway server on 127.0.0.1 (random port) serving the same roots picker as the
// Settings view, which writes the chosen roots to <file> and exits 0. Ctrl-C
// leaves the file untouched and exits non-zero, which the installer reads as "no
// change". The installer stays the only thing that writes the LaunchAgent plist.
//
// Same routes as the live server (src/settings/routes.ts), so the folder listing,
// the boot verdict and the file format cannot differ between install and Settings.
// On top of their this-machine-only gate, every API call must carry a one-time
// token minted here and handed to the browser in the URL, so nothing else on this
// machine can drive the picker while it waits.

import path from 'path'
import os from 'os'
import { existsSync } from 'fs'
import { randomBytes, timingSafeEqual } from 'crypto'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { registerErrorHandler } from '../errors.js'
import { registerStaticRoutes } from '../static-files.js'
import { registerSettingsRoutes } from '../settings/routes.js'
import { readRootsFile } from '../settings/selection.js'

export interface ParsedPickRootsArgs {
  /** Roots file to write. */
  write: string
  /** Port to listen on; 0 picks a free one. */
  port: number
}

export function parsePickRootsArgs(argv: string[], cwd: string = process.cwd()): ParsedPickRootsArgs {
  let write: string | undefined
  let port = 0
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    const value = argv[i + 1]
    if (token === '--write' || token === '--port') {
      if (value === undefined || value.startsWith('--')) throw new Error(`${token} requires a value`)
      if (token === '--write') write = path.resolve(cwd, value)
      else {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`--port must be an integer between 0 and 65535, got "${value}"`)
        port = n
      }
      i++
    } else {
      throw new Error(`unknown flag: ${token}`)
    }
  }
  if (write === undefined) throw new Error('--write <roots file> is required')
  return { write, port }
}

export interface PickRootsDeps {
  /** Open the picker in a browser. */
  launch: (url: string) => Promise<void>
  stdout: (s: string) => void
  stderr: (s: string) => void
  frontendDist: string
  /** Top of the folder tree. Defaults to the home directory. */
  home?: string
}

export const SETUP_TOKEN_HEADER = 'x-vibedocs-setup-token'

export async function runPickRoots(args: ParsedPickRootsArgs, deps: PickRootsDeps): Promise<number> {
  if (!existsSync(path.join(deps.frontendDist, 'index.html'))) {
    deps.stderr(`vibedocs pick-roots: no built frontend at ${deps.frontendDist} — run \`npm run build\` first.\n`)
    return 1
  }

  const token = randomBytes(16).toString('hex')
  const current = (await readRootsFile(args.write)) ?? []
  let port = 0
  let resolveSaved!: (roots: string[]) => void
  const saved = new Promise<string[]>((r) => (resolveSaved = r))

  const app = new Hono()
  registerErrorHandler(app)
  app.use('/api/*', async (c, next) => {
    if (!sameToken(token, c.req.header(SETUP_TOKEN_HEADER))) {
      return c.json({ error: 'This page belongs to another install run. Re-run the installer.' }, 403)
    }
    await next()
  })
  registerSettingsRoutes(app, {
    enabled: true,
    port: () => port,
    peerAddress: (c) => getConnInfo(c).remote.address,
    home: deps.home ?? os.homedir(),
    roots: current,
    source: { kind: 'file', file: args.write },
    rootsFile: args.write,
    afterSave: 'done',
    onSaved: (roots) => resolveSaved(roots),
  })
  registerStaticRoutes(app, deps.frontendDist)

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port: args.port, hostname: '127.0.0.1' }, (info) => {
      port = info.port
      resolve(s)
    })
  })

  const url = `http://127.0.0.1:${port}/?setup=${token}`
  deps.stdout(`Choose the folders to index in your browser:\n  ${url}\nWaiting for your choice (Ctrl-C to cancel)…\n`)
  try {
    await deps.launch(url)
  } catch (err) {
    deps.stderr(`vibedocs pick-roots: ${(err as Error).message}. Open the address above yourself.\n`)
  }

  const roots = await saved
  // Let the page receive its response before the socket goes, then drop the
  // browser's keep-alive connection too: close() alone waits for it.
  await new Promise((r) => setTimeout(r, 250))
  const http = server as unknown as import('http').Server
  await new Promise<void>((r) => {
    http.close(() => r())
    http.closeAllConnections()
  })
  deps.stdout(`Saved ${roots.length} root${roots.length === 1 ? '' : 's'} to ${args.write}\n`)
  return 0
}

function sameToken(expected: string, provided: string | undefined): boolean {
  if (provided === undefined || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}
