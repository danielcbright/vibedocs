import path from 'path'
import { readFile } from 'fs/promises'
import {
  buildTreePublic,
  type FileNode,
} from './discovery.js'
import { extractToc } from './markdown-plugins.js'
import type { SiteConfig } from './site-config.js'
import type { SafePath } from './path-resolver.js'
import { createReferenceCollector } from './reference-collector.js'
import { createMarkdownProcessor } from './markdown-processor.js'
import {
  buildPageUrl,
  type RenderMode,
  type RewriteOptions,
} from './url-rewriter.js'
import { isMarkdownPath } from './markdown-paths.js'

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

// Re-export RenderMode so existing imports from './render.js' keep working.
export type { RenderMode } from './url-rewriter.js'

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

export interface MissingRef {
  /** Project-relative POSIX path of the doc that contains the reference. */
  sourceDoc: string
  /** Project-relative POSIX path that was referenced but not found on disk. */
  missingPath: string
}

export interface RenderResult {
  pages: HtmlPage[]
  /** Non-markdown files actually referenced by rendered pages (build mode: filtered; live mode: all). */
  assets: AssetRef[]
  /** References the rewriter saw but that don't exist on disk. */
  missingRefs: MissingRef[]
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
 * Thin wrapper around the markdown processor factory. Each render builds a
 * fresh processor because the rewrite plugin captures per-page state
 * (currentDocPath). Shiki init is the slow part; it's amortised by the
 * @shikijs/rehype singleton highlighter cache.
 */
async function renderMarkdownForPage(
  content: string,
  opts: RewriteOptions,
): Promise<string> {
  const processor = createMarkdownProcessor(opts)
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

  const collector = createReferenceCollector()
  const pages: HtmlPage[] = []
  // Collect all non-markdown files for cross-checking after render.
  const allAssets: AssetRef[] = []

  for (const file of files) {
    const posixPath = file.path.split(path.sep).join('/')
    if (isMarkdownPath(posixPath)) {
      const absPath = path.join(projectPath, file.path)
      const content = await readFile(absPath, 'utf-8')
      const html = await renderMarkdownForPage(content, {
        mode,
        projectName,
        currentDocPath: posixPath,
        collector,
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
      allAssets.push({
        sourcePath: posixPath,
        url:
          mode === 'live'
            ? buildLiveAssetUrl(projectName, posixPath)
            : '/' + posixPath,
      })
    }
  }

  // Cross-check collected refs against the discovery set. Referenced files
  // that exist → filtered asset list. Referenced files that don't exist →
  // missingRefs (warnings for the build CLI; returned regardless).
  const knownPaths = new Set(allAssets.map((a) => a.sourcePath))
  const referenced = new Set<string>()
  const missingRefs: MissingRef[] = []
  for (const ref of collector.getRefs()) {
    if (knownPaths.has(ref.resolvedPath)) {
      referenced.add(ref.resolvedPath)
    } else {
      missingRefs.push({ sourceDoc: ref.sourceDoc, missingPath: ref.resolvedPath })
    }
  }
  const assets = allAssets.filter((a) => referenced.has(a.sourcePath))

  // llms.txt is build-mode + has-siteConfig only. The real generator lands in
  // slice #53; this slice commits to the empty-string placeholder so downstream
  // consumers can write `if (result.llmsTxt) fs.writeFile(...)` without
  // special-casing the per-mode gate.
  const llmsTxt = mode === 'build' && siteConfig !== null ? '' : null

  return {
    pages,
    assets,
    missingRefs,
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
