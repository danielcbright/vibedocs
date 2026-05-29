// Rehype plugin: rewrite `<a href>` and `<img src>` attributes on the rendered
// page so they point at the right place for the current render mode.
//
// Extracted from `src/render.ts` as part of the markdown-processor-factory
// refactor (issue #85). The rewriter captures per-page state
// (currentDocPath, collector), so each page needs its own configured
// instance. Living next to `markdown-processor.ts` keeps the factory's
// dependencies explicit.

import path from 'path'
import { visit } from 'unist-util-visit'
import type { Node } from 'unist'
import type { ReferenceCollector } from './reference-collector.js'

/**
 * Render mode controls URL shape for in-project links and assets.
 *
 * - `live`: the Hono server consumes the result per request. Internal `.md`
 *   links keep their `.md` extension (the SPA hash-router intercepts them);
 *   asset URLs point at the live `/api/file/<project>/<path>` endpoint.
 * - `build`: the build CLI consumes the result once per project. Internal
 *   `.md` links are rewritten to clean URLs (`./install/`); asset URLs are
 *   relative paths to the asset's eventual mirrored location under `dist/`.
 */
export type RenderMode = 'live' | 'build'

export interface RewriteOptions {
  mode: RenderMode
  projectName: string
  /** Project-relative POSIX path of the doc currently being rendered. */
  currentDocPath: string
  /** When present, the rewriter records each resolved asset reference here. */
  collector?: ReferenceCollector
}

// Markdown extension match — case-insensitive everywhere.
const MD_EXTENSION_RE = /\.(md|markdown)$/i

function isMarkdown(filePath: string): boolean {
  return MD_EXTENSION_RE.test(filePath)
}

/**
 * Build the live-mode asset URL for a project-relative POSIX path.
 *
 * Mirrors the live `/api/file/<project>/<path>` route. Each path segment is
 * URI-encoded so names with spaces or unicode round-trip correctly.
 */
function buildLiveAssetUrl(projectName: string, posixPath: string): string {
  const encodedProject = encodeURIComponent(projectName)
  const encodedPath = posixPath.split('/').map(encodeURIComponent).join('/')
  return `/api/file/${encodedProject}/${encodedPath}`
}

/**
 * hast element shape — we only touch href/src on `a`/`img`.
 */
interface HastElement extends Node {
  type: 'element'
  tagName: string
  properties?: Record<string, unknown>
  children: unknown[]
}

/**
 * Is this URL one we should leave untouched? External URLs, fragment-only
 * links, protocol-relative URLs, and data: URIs all stay as-is.
 *
 * In-page anchor links (`#section`) are also left alone — they refer to
 * elements within the same rendered page.
 */
function isExternalOrSpecialUrl(url: string): boolean {
  if (!url) return true
  if (url.startsWith('#')) return true
  if (url.startsWith('//')) return true
  if (url.startsWith('mailto:')) return true
  if (url.startsWith('tel:')) return true
  if (url.startsWith('data:')) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return true
  return false
}

/**
 * Resolve a relative URL written in markdown against the directory of the
 * current document. Returns the project-relative POSIX path of the target.
 *
 * Returns null if the resolved path escapes the project root.
 */
function resolveProjectRelative(
  currentDocPath: string,
  relativeUrl: string,
): string | null {
  const currentDir = path.posix.dirname(currentDocPath)
  const [pathPart] = relativeUrl.split(/[?#]/)
  if (!pathPart) return null
  const joined = path.posix.normalize(path.posix.join(currentDir, pathPart))
  if (joined.startsWith('../') || joined === '..') return null
  return joined
}

/**
 * Compute the build-mode URL for a markdown page. Clean URLs: strip the
 * `.md`/`.markdown` extension and add a trailing slash so the deployed file
 * `docs/install/index.html` is reachable at `docs/install/`.
 *
 * README.md at the project root becomes `/` (the site root). Any other
 * `README.md` (e.g. `docs/README.md`) becomes its containing directory.
 */
export function buildPageUrl(projectRelativePath: string): string {
  const noExt = projectRelativePath.replace(/\.(md|markdown)$/i, '')
  if (noExt === 'README' || noExt === 'index') return '/'
  if (noExt.endsWith('/README') || noExt.endsWith('/index')) {
    return '/' + noExt.replace(/\/(README|index)$/, '/')
  }
  return '/' + noExt + '/'
}

/**
 * Compute a relative URL from one page's URL to another resource's URL.
 *
 * Both inputs must be absolute (start with `/`). The result is a relative
 * URL suitable for use as an `<a href>` or `<img src>` value in the page.
 */
function relativeUrl(fromPageUrl: string, toResourceUrl: string): string {
  const fromDir = fromPageUrl.endsWith('/')
    ? fromPageUrl
    : path.posix.dirname(fromPageUrl) + '/'
  let rel = path.posix.relative(fromDir, toResourceUrl)
  if (rel === '') rel = './'
  if (toResourceUrl.endsWith('/') && !rel.endsWith('/')) rel += '/'
  if (!rel.startsWith('.') && !rel.startsWith('/')) rel = './' + rel
  return rel
}

/**
 * Rehype plugin: rewrite `<a href>` and `<img src>` attributes on the rendered
 * page so they point at the right place for the current render mode.
 *
 * External URLs (http://, https://, mailto:, etc.), fragment-only links
 * (#section), and data: URIs are left untouched.
 */
export function rehypeRewriteUrls(opts: RewriteOptions) {
  return (tree: Node) => {
    visit(tree, 'element', (node: HastElement) => {
      if (!node.properties) return
      if (node.tagName === 'a') {
        const href = node.properties.href
        if (typeof href !== 'string' || isExternalOrSpecialUrl(href)) return
        const rewritten = rewriteHref(href, opts)
        if (rewritten !== null) node.properties.href = rewritten
      } else if (node.tagName === 'img') {
        const src = node.properties.src
        if (typeof src !== 'string' || isExternalOrSpecialUrl(src)) return
        const rewritten = rewriteAssetUrl(src, opts)
        if (rewritten !== null) node.properties.src = rewritten
      }
    })
  }
}

function rewriteHref(href: string, opts: RewriteOptions): string | null {
  const match = href.match(/^([^?#]*)([?#].*)?$/)
  if (!match) return null
  const pathPart = match[1] ?? ''
  const suffix = match[2] ?? ''

  if (!isMarkdown(pathPart)) {
    if (opts.mode === 'build') {
      return rewriteAssetUrl(href, opts)
    }
    return null
  }

  if (opts.mode === 'live') {
    return null
  }

  const resolved = resolveProjectRelative(opts.currentDocPath, pathPart)
  if (resolved === null) return null
  const targetPageUrl = buildPageUrl(resolved)
  const currentPageUrl = buildPageUrl(opts.currentDocPath)
  return relativeUrl(currentPageUrl, targetPageUrl) + suffix
}

function rewriteAssetUrl(src: string, opts: RewriteOptions): string | null {
  const match = src.match(/^([^?#]*)([?#].*)?$/)
  if (!match) return null
  const pathPart = match[1] ?? ''
  const suffix = match[2] ?? ''
  const resolved = resolveProjectRelative(opts.currentDocPath, pathPart)
  if (resolved === null) return null

  opts.collector?.add(resolved, opts.currentDocPath)

  if (opts.mode === 'live') {
    return buildLiveAssetUrl(opts.projectName, resolved) + suffix
  }

  const currentPageUrl = buildPageUrl(opts.currentDocPath)
  const assetUrl = '/' + resolved
  return relativeUrl(currentPageUrl, assetUrl) + suffix
}
