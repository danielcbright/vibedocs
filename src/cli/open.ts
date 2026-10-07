// `vibedocs open <path>` — open a markdown file in the running live server.
//
// The CLI side of `GET /open` (src/open-route.ts). It asks the server first and
// opens the browser only on a redirect: a refusal (outside every root, not
// markdown, missing) becomes the server's reason on stderr and exit 1, which is
// what a terminal user reads and what a script can test. The server stays the
// only judge of what can be opened — it alone knows the roots it booted with.

import path from 'path'
import { spawn } from 'child_process'

export interface ParsedOpenArgs {
  /** Absolute path of the file to open. */
  path: string
  /** Port the live server listens on. */
  port: number
}

/**
 * Parse `vibedocs open` arguments: one path, optionally `--port <n>`.
 *
 * The default port follows the server's own lookup (VIBEDOCS_PORT, then PORT,
 * then 8080), so an operator who exported a port for `vibedocs serve` does not
 * have to repeat it here.
 */
export function parseOpenArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): ParsedOpenArgs {
  let target: string | undefined
  let port = parsePort(env.VIBEDOCS_PORT || env.PORT || '8080', 'VIBEDOCS_PORT')

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token === '--port') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('--port requires a value')
      port = parsePort(value, '--port')
      i++
    } else if (token.startsWith('--')) {
      throw new Error(`unknown flag: ${token}`)
    } else if (target !== undefined) {
      throw new Error('takes one path')
    } else {
      target = token
    }
  }

  if (target === undefined) throw new Error('a path to a markdown file is required')
  return { path: path.resolve(cwd, target), port }
}

function parsePort(value: string, name: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535, got "${value}"`)
  }
  return n
}

export interface OpenDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  /** Open a URL in the user's browser. */
  launch: (url: string) => Promise<void>
  stdout: (s: string) => void
  stderr: (s: string) => void
}

export async function runOpen(args: ParsedOpenArgs, deps: OpenDeps): Promise<number> {
  const origin = `http://localhost:${args.port}`
  const url = `${origin}/open?path=${encodeURIComponent(args.path)}`

  let res: Response
  try {
    res = await deps.fetch(url, { redirect: 'manual', headers: { Accept: 'application/json' } })
  } catch {
    deps.stderr(
      `vibedocs open: nothing is answering on ${origin}.\n` +
        '  Start the live server with `vibedocs serve`, or pass --port if it runs elsewhere.\n',
    )
    return 1
  }

  const location = res.headers.get('location')
  if (res.status === 302 && location !== null) {
    const target = new URL(location, origin).toString()
    try {
      await deps.launch(target)
    } catch (err) {
      deps.stderr(`vibedocs open: ${(err as Error).message}. Open it yourself:\n  ${target}\n`)
      return 1
    }
    deps.stdout(`${target}\n`)
    return 0
  }

  const reason = await readReason(res)
  deps.stderr(
    reason !== null
      ? `vibedocs open: ${reason}\n`
      : `vibedocs open: unexpected ${res.status} from ${origin} — is it a VibeDocs server new enough to have /open?\n`,
  )
  return 1
}

async function readReason(res: Response): Promise<string | null> {
  if (!res.headers.get('content-type')?.includes('application/json')) return null
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

/** Platform browser opener: `open` on macOS, `xdg-open` elsewhere. */
export function launchInBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  return new Promise((resolve, reject) => {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true })
    child.on('error', (err) => reject(new Error(`could not run ${command}: ${err.message}`)))
    child.on('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
