/**
 * `GET /open?path=<absolute path>` — open a markdown file by where it is on disk.
 *
 * The contract is fixed: a macOS `.md` handler app calls
 * `http://localhost:8080/open?path=<url-encoded absolute path>`, and `vibedocs open`
 * builds the same URL. A path inside a root answers 302 to the document's hash
 * route; anything else answers a readable HTML page saying why, because the reader
 * is a person whose browser just opened, not a client checking a status code.
 *
 * Nothing here decides naming or what may be served:
 *
 * - The hash route is `toProjectRelativePath`, the same spelling the WebSocket
 *   reload carries, which goes through `projectNameFor` — so `/open` agrees with the
 *   sidebar, search and live reload about what a project is called.
 * - Whether the file may be served is `PathResolver`'s answer (traversal, dot and
 *   excluded segments, markdown extension), so those rules stay in one place.
 *
 * Root containment is decided BEFORE anything is stat'ed, so a path outside every
 * root gets one answer whether or not it exists: this route must not become a way
 * to probe the filesystem. The same holds for hidden and excluded folders.
 */
import type { Hono } from 'hono'
import path from 'path'
import { realpathSync } from 'fs'
import { stat } from 'fs/promises'
import { toProjectRelativePath } from './discovery.js'
import { VibedocsError } from './errors.js'
import type { PathResolver } from './path-resolver.js'

export interface OpenRouteDeps {
  /** Every configured root, in order. */
  roots: readonly string[]
  /** The markdown-only resolver the render route uses. */
  docResolver: PathResolver
}

type OpenOutcome =
  | { kind: 'redirect'; location: string }
  | { kind: 'refused'; status: 400 | 404; title: string; detail: string }

export function registerOpenRoute(app: Hono, deps: OpenRouteDeps): void {
  app.get('/open', async (c) => {
    const outcome = await resolveOpen(c.req.query('path'), deps)
    if (outcome.kind === 'redirect') return c.redirect(outcome.location, 302)
    return new Response(refusalPage(outcome.title, outcome.detail), {
      status: outcome.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}

async function resolveOpen(raw: string | undefined, deps: OpenRouteDeps): Promise<OpenOutcome> {
  if (!raw) {
    return refused(400, 'No file named', 'Pass the absolute path of a markdown file: /open?path=/Users/you/notes/README.md')
  }
  if (!path.isAbsolute(raw)) {
    return refused(400, 'Not an absolute path', `“${raw}” is not an absolute path. /open takes the full path of a markdown file.`)
  }

  const abs = path.resolve(raw)
  const spelled = spellUnderRoot(abs, deps.roots)
  if (spelled === null) {
    return refused(404, 'Not in VibeDocs', `“${abs}” is not inside any folder VibeDocs indexes. Add its folder as a root, or open a file under one of your roots.`)
  }

  // `<project>/<path within project>`, or null for a root itself.
  const wire = toProjectRelativePath(spelled, deps.roots)
  const slash = wire?.indexOf('/') ?? -1
  if (wire === null || slash === -1) {
    return refused(404, 'Not in a project', `“${abs}” is not inside a project folder. VibeDocs shows the files inside each folder of a root, not the root itself or files sitting directly in it.`)
  }

  let safePath: string
  try {
    safePath = deps.docResolver.resolve(wire.slice(0, slash), wire.slice(slash + 1))
  } catch (err) {
    if (!(err instanceof VibedocsError)) throw err
    switch (err.code) {
      case 'forbidden':
        return refused(404, 'Hidden folder', `“${abs}” is inside a hidden or excluded folder (a dot-folder, node_modules, dist and the like), which VibeDocs never serves.`)
      case 'invalid':
        return notMarkdown(abs)
      case 'not-found':
        return missing(abs)
      default:
        // `traversal` cannot follow a normalised path inside a root; if it ever
        // does, the resolver has the last word and the answer is still "outside".
        return refused(404, 'Not in VibeDocs', `“${abs}” is not inside any folder VibeDocs indexes.`)
    }
  }

  try {
    if ((await stat(safePath)).isDirectory()) return notMarkdown(abs)
  } catch {
    return missing(abs)
  }

  return { kind: 'redirect', location: `/#${encodeFragment(wire)}` }
}

/**
 * The path as spelled under a configured root, or null when it is under none.
 *
 * Tried as given first. Failing that, by realpath on both sides — a root may be a
 * symlink when configured by hand, and Finder (or a shell, whose cwd is physical)
 * hands over the resolved path. The answer is re-spelled under the root as
 * configured, because project names are derived from that spelling.
 */
function spellUnderRoot(abs: string, roots: readonly string[]): string | null {
  if (roots.some((r) => isWithinOrEqual(abs, r))) return abs

  const real = realpathOrNull(abs)
  if (real === null) return null
  for (const root of roots) {
    const realRoot = realpathOrNull(root)
    if (realRoot !== null && isWithinOrEqual(real, realRoot)) {
      return path.join(root, path.relative(realRoot, real))
    }
  }
  return null
}

function isWithinOrEqual(target: string, root: string): boolean {
  return target === root || target.startsWith(root + path.sep)
}

function realpathOrNull(p: string): string | null {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}

/**
 * Percent-encode what a browser would when storing a URL fragment (WHATWG fragment
 * percent-encode set: C0 controls, space, `"`, `<`, `>`, backtick) plus DEL and
 * non-ASCII, which a header cannot carry raw. Everything else is left alone, so the
 * result equals the fragment the sidebar's own navigation produces — `%` included,
 * which is why this is not `encodeURI`.
 */
function encodeFragment(wire: string): string {
  return wire.replace(/[\u0000- "<>`\u007f]|[^\u0000-\u007f]/gu, (ch) => encodeURIComponent(ch))
}

const refused = (status: 400 | 404, title: string, detail: string): OpenOutcome => ({ kind: 'refused', status, title, detail })
const notMarkdown = (abs: string) => refused(404, 'Not a markdown file', `“${abs}” is not a markdown file. /open opens .md and .markdown files.`)
const missing = (abs: string) => refused(404, 'No such file', `There is no file at “${abs}”.`)

function refusalPage(title: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VibeDocs — ${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.55 system-ui, -apple-system, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1.25rem; color: #1f2328; background: #fff; }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  p { margin: 0 0 1rem; overflow-wrap: anywhere; }
  a { color: #0969da; }
  @media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } a { color: #4493f8; } }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(detail)}</p>
<p><a href="/">Open VibeDocs</a></p>
</body>
</html>
`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
