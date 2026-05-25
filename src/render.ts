import path from 'path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeStringify from 'rehype-stringify'
import rehypeShiki from '@shikijs/rehype'
import rehypeSanitize from 'rehype-sanitize'
import { visit } from 'unist-util-visit'
import type { Node } from 'unist'
import { readFile } from 'fs/promises'
import {
  buildTreePublic,
  type FileNode,
} from './discovery.js'
import {
  remarkMermaid,
  rehypeWrapTables,
  sanitizeSchema,
  extractToc,
} from './markdown-plugins.js'
import type { SiteConfig } from './site-config.js'
import type { SafePath } from './path-resolver.js'

/**
 * Pure renderer for a single project. Walks the project tree, renders every
 * markdown file to HTML, and returns the rendered pages plus asset references
 * and (when appropriate) generated meta-files.
 *
 * The renderer is mode-aware about two things — see {@link RenderMode}.
 *
 * It is PURE: no `fs.writeFile`, no HTTP, no chokidar coupling. The live Hono
 * server and the build CLI both invoke this same module.
 */

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

export interface TocEntry {
  level: number
  id: string
  text: string
}

export interface HtmlPage {
  /** Source path relative to the project root, e.g. `"docs/install.md"`. */
  path: string
  /** Canonical URL for this page; mode-dependent. */
  url: string
  /** Rendered article HTML — content only, no `<head>`, no chrome. */
  html: string
  /** Table-of-contents headings extracted from the rendered HTML. */
  toc: TocEntry[]
  /** Parsed frontmatter. Empty until slice #50 wires gray-matter. */
  frontmatter: Record<string, unknown>
}

export interface AssetRef {
  /** Source path relative to the project root. */
  sourcePath: string
  /** Canonical URL for this asset; mode-dependent. */
  url: string
}

export interface RenderResult {
  pages: HtmlPage[]
  assets: AssetRef[]
  /**
   * llms.txt content. Null when `siteConfig` is null (no site identity to
   * describe) or when `mode === 'live'` (the build CLI is what writes the
   * file). Slice #53 fills the real generator in.
   */
  llmsTxt: string | null
  /** sitemap.xml content. Null in this slice; slice #54 fills it. */
  sitemap: string | null
  /** robots.txt content. Null in this slice; slice #54 fills it. */
  robots: string | null
}

// Markdown extension match — case-insensitive everywhere. The build-mode URL
// builder uses `/\.(md|markdown)$/i`; align the predicate so a `README.MD`
// link doesn't fall into the asset-rewriter path while the page renders as
// markdown. (The discovery walk lists files verbatim from the FS, so case
// preservation matters on case-sensitive filesystems.)
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

function flattenTree(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = []
  for (const node of nodes) {
    if (node.type === 'folder') {
      out.push(...flattenTree(node.children || []))
    } else {
      out.push(node)
    }
  }
  return out
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
  // Any explicit scheme (http:, https:, ftp:, javascript:...) — sanitizer
  // already drops the dangerous ones; we just don't rewrite the safe ones.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return true
  return false
}

/**
 * Resolve a relative URL written in markdown against the directory of the
 * current document. Returns the project-relative POSIX path of the target.
 *
 * Example: currentDocPath=`docs/install.md`, relativeUrl=`./diagram.png`
 *          → `docs/diagram.png`
 *
 * Example: currentDocPath=`docs/install.md`, relativeUrl=`../README.md`
 *          → `README.md`
 *
 * Returns null if the resolved path escapes the project root.
 */
function resolveProjectRelative(
  currentDocPath: string,
  relativeUrl: string,
): string | null {
  const currentDir = path.posix.dirname(currentDocPath)
  // Strip any query/fragment for path resolution; we re-attach later.
  const [pathPart] = relativeUrl.split(/[?#]/)
  if (!pathPart) return null
  // Treat as POSIX even on Windows — markdown links are URL-shaped.
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
function buildPageUrl(projectRelativePath: string): string {
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
 *
 * Example: fromPageUrl=`/docs/install/`, toResourceUrl=`/docs/diagram.png`
 *          → `../diagram.png`
 *
 * Example: fromPageUrl=`/`, toResourceUrl=`/docs/install/`
 *          → `./docs/install/`
 */
function relativeUrl(fromPageUrl: string, toResourceUrl: string): string {
  // path.posix.relative treats both as filesystem paths; for a page URL
  // ending in `/`, the "directory" is the URL itself. For one not ending
  // in `/`, the "directory" is its parent. Markdown pages in build mode
  // always end with `/`, so the page URL IS the directory.
  const fromDir = fromPageUrl.endsWith('/')
    ? fromPageUrl
    : path.posix.dirname(fromPageUrl) + '/'
  let rel = path.posix.relative(fromDir, toResourceUrl)
  if (rel === '') rel = './'
  // path.posix.relative strips a trailing slash from the target; re-attach it
  // when the target URL was a directory-style URL. This matters for clean-URL
  // page links like `./docs/install/`, where the trailing `/` is what makes
  // the browser request index.html.
  if (toResourceUrl.endsWith('/') && !rel.endsWith('/')) rel += '/'
  if (!rel.startsWith('.') && !rel.startsWith('/')) rel = './' + rel
  return rel
}

interface RewriteOptions {
  mode: RenderMode
  projectName: string
  /** Project-relative POSIX path of the doc currently being rendered. */
  currentDocPath: string
}

/**
 * Rehype plugin: rewrite `<a href>` and `<img src>` attributes on the rendered
 * page so they point at the right place for the current render mode.
 *
 * - `.md` / `.markdown` links: build mode → clean URLs (`./docs/install/`),
 *   live mode → unchanged (the SPA hash-router intercepts them).
 * - Image / asset links: build mode → relative path to the mirrored asset
 *   location under `dist/`, live mode → `/api/file/<project>/<path>`.
 *
 * External URLs (http://, https://, mailto:, etc.), fragment-only links
 * (#section), and data: URIs are left untouched.
 */
function rehypeRewriteUrls(opts: RewriteOptions) {
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
  // Split off query/fragment for resolution, reattach afterwards.
  const match = href.match(/^([^?#]*)([?#].*)?$/)
  if (!match) return null
  const pathPart = match[1] ?? ''
  const suffix = match[2] ?? ''

  if (!isMarkdown(pathPart)) {
    // Non-markdown link: in build mode treat as an asset (so e.g. a link to a
    // PDF gets the relative-mirrored URL); in live mode leave alone, matching
    // today's behaviour where links pointing at non-md files would 404 in the
    // SPA but are the author's responsibility.
    if (opts.mode === 'build') {
      return rewriteAssetUrl(href, opts)
    }
    return null
  }

  if (opts.mode === 'live') {
    // Live mode: leave .md links untouched. The SPA hash-router rewrites
    // clicks into hash routes at runtime.
    return null
  }

  // Build mode: rewrite to clean URL.
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

  if (opts.mode === 'live') {
    // Live mode: serve through the existing /api/file/... endpoint.
    return buildLiveAssetUrl(opts.projectName, resolved) + suffix
  }

  // Build mode: relative path from the page's URL to the asset's mirrored
  // location at `/<asset-source-path>`.
  const currentPageUrl = buildPageUrl(opts.currentDocPath)
  const assetUrl = '/' + resolved
  return relativeUrl(currentPageUrl, assetUrl) + suffix
}

async function renderMarkdownForPage(
  content: string,
  opts: RewriteOptions,
): Promise<string> {
  // Each render builds a fresh processor because the rewrite plugin captures
  // per-page state (currentDocPath). Shiki init is the slow part; it's
  // amortised by the @shikijs/rehype singleton highlighter cache.
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMermaid)
    .use(remarkRehype)
    .use(rehypeShiki, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      fallbackLanguage: 'text',
    })
    .use(rehypeWrapTables)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: 'wrap',
      properties: { className: ['heading-anchor'] },
    })
    .use(rehypeRewriteUrls, opts)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
  const result = await processor.process(content)
  return String(result)
}

export async function renderProject(
  projectPath: string,
  siteConfig: SiteConfig | null,
  mode: RenderMode,
): Promise<RenderResult> {
  const projectName = path.basename(projectPath)
  const tree = await buildTreePublic(projectPath, projectPath)
  const files = flattenTree(tree)

  const pages: HtmlPage[] = []
  const assets: AssetRef[] = []

  for (const file of files) {
    const posixPath = file.path.split(path.sep).join('/')
    if (isMarkdown(posixPath)) {
      const absPath = path.join(projectPath, file.path)
      const content = await readFile(absPath, 'utf-8')
      const html = await renderMarkdownForPage(content, {
        mode,
        projectName,
        currentDocPath: posixPath,
      })
      const toc = extractToc(html)
      pages.push({
        path: posixPath,
        url: mode === 'build' ? buildPageUrl(posixPath) : posixPath,
        html,
        toc,
        frontmatter: {},
      })
    } else {
      assets.push({
        sourcePath: posixPath,
        url:
          mode === 'live'
            ? buildLiveAssetUrl(projectName, posixPath)
            : '/' + posixPath,
      })
    }
  }

  // llms.txt is build-mode + has-siteConfig only. The real generator lands in
  // slice #53; this slice commits to the empty-string placeholder so downstream
  // consumers can write `if (result.llmsTxt) fs.writeFile(...)` without
  // special-casing the per-mode gate.
  const llmsTxt = mode === 'build' && siteConfig !== null ? '' : null

  return {
    pages,
    assets,
    llmsTxt,
    sitemap: null,
    robots: null,
  }
}

/**
 * Render exactly one page from a project. Used by the live Hono route, which
 * doesn't need the full project walk. The return shape matches one entry of
 * `renderProject`'s `pages` array.
 *
 * The first argument is a `SafePath` — a filesystem path that has been
 * validated by `PathResolver`. Requiring a `SafePath` (not a raw string)
 * surfaces traversal-bypass bugs at compile time: any caller that hands in
 * an unvalidated string fails type-checking. See security #7.
 *
 * `projectName` and `docPath` are metadata the URL rewriter needs (they
 * shape `/api/file/...` URLs and resolve relative links). They are NOT
 * re-joined into a filesystem path inside this function.
 *
 * Throws if `absPath` is missing on disk; the caller maps ENOENT to
 * `VibedocsError('not-found')`.
 */
export async function renderSinglePage(
  absPath: SafePath,
  projectName: string,
  docPath: string,
  mode: RenderMode,
): Promise<HtmlPage> {
  const posixPath = docPath.split(path.sep).join('/')
  const content = await readFile(absPath, 'utf-8')
  const html = await renderMarkdownForPage(content, {
    mode,
    projectName,
    currentDocPath: posixPath,
  })
  const toc = extractToc(html)
  return {
    path: posixPath,
    url: mode === 'build' ? buildPageUrl(posixPath) : posixPath,
    html,
    toc,
    frontmatter: {},
  }
}
