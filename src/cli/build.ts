// `vibedocs build` — emit a static dist/ from a project's markdown docs.
//
// Slice #49 scaffolding: walks the project, calls the pure renderer in build
// mode, writes per-page HTML using the hardcoded template, mirrors asset
// files to <out>/<source-path>, and copies the React bundle from
// frontend/dist into <out>/assets/. Later slices layer SEO meta (slice #50),
// theming (slice #51), llms.txt (slice #53), sitemap (slice #54), edit-on-
// GitHub (slice #55), and Pagefind (slice #56) on top.
//
// Pure orchestration: this module owns the FS writes. The renderer
// (src/render.ts) stays pure; the template (src/cli/template.ts) stays
// string-only.

import path from 'path'
import { stat, mkdir, writeFile, readFile, readdir, cp } from 'fs/promises'
import { renderProject, type HtmlPage } from '../render.js'
import { loadSiteConfig, type SiteConfig } from '../site-config.js'
import { composePageHtml, type NavLink } from './template.js'

export interface BuildOptions {
  /** Project name as supplied on the CLI (`--project <name>`). */
  projectName: string
  /** Where to look for `<name>` as a sibling directory. */
  projectsRoot: string
  /** Output directory (`--out <dir>`). Created if it doesn't exist. */
  outDir: string
  /** Path to the built frontend dist (vibedocs's React app). */
  frontendDist: string
  /** `--base-url` override; threaded through but not yet emitted in slice #49. */
  baseUrl?: string
  /** cwd used for the "basename matches project name" fallback. */
  cwd?: string
  /** When true, list each copied asset path before the summary. */
  verbose?: boolean
}

/**
 * Locate a project on disk.
 *
 * Resolution order:
 * 1. `<projectsRoot>/<projectName>` if it exists and is a directory.
 * 2. `<cwd>` if `path.basename(cwd) === projectName` — covers running
 *    `vibedocs build --project vibedocs` from inside the vibedocs repo.
 * 3. `<cwd>` if a sibling `package.json` declares `name === projectName` —
 *    covers running from inside a worktree of the project, where the cwd
 *    basename is the worktree branch slug rather than the project name.
 * 4. Otherwise: throw a clear, actionable error.
 */
export async function resolveProjectPath(
  projectName: string,
  projectsRoot: string,
  cwd: string,
): Promise<string> {
  const siblingPath = path.join(projectsRoot, projectName)
  if (await isDir(siblingPath)) return siblingPath
  if (path.basename(cwd) === projectName && (await isDir(cwd))) return cwd
  if (await packageNameMatches(cwd, projectName)) return cwd
  throw new Error(
    `Project "${projectName}" not found. ` +
      `Looked for "${siblingPath}" and for a current directory named "${projectName}". ` +
      `Set VIBEDOCS_ROOT to the directory containing your project, or run from inside the project.`,
  )
}

async function packageNameMatches(cwd: string, projectName: string): Promise<boolean> {
  try {
    const raw = await readFile(path.join(cwd, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { name?: unknown }
    return typeof pkg.name === 'string' && pkg.name === projectName
  } catch {
    return false
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Find the React bundle entry script that `frontend/dist/index.html` loads.
 * Vite emits a hashed filename (`index-<hash>.js`) — we read the built
 * index.html and grep out the first `<script type="module" src="...">` URL.
 */
async function detectBundleEntry(frontendDist: string): Promise<string> {
  const indexHtmlPath = path.join(frontendDist, 'index.html')
  if (!(await fileExists(indexHtmlPath))) {
    throw new Error(
      `Frontend bundle not found at "${indexHtmlPath}". ` +
        `Run \`npm run build\` first (or supply --frontend-dist).`,
    )
  }
  const html = await readFile(indexHtmlPath, 'utf-8')
  const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)
  if (!m) {
    throw new Error(
      `Could not find the React bundle entry in "${indexHtmlPath}". ` +
        `Expected a <script type="module" src="..."> tag.`,
    )
  }
  return m[1]!
}

/**
 * Detect the stylesheet link (Vite emits one CSS file alongside the JS entry).
 * Optional — returns undefined if no <link rel=stylesheet> in the built
 * index.html.
 */
async function detectStylesheet(frontendDist: string): Promise<string | undefined> {
  const indexHtmlPath = path.join(frontendDist, 'index.html')
  const html = await readFile(indexHtmlPath, 'utf-8')
  const m = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/i)
  return m ? m[1]! : undefined
}

/**
 * Derive a page title from its rendered HTML. We use the first `<h1>` text
 * when present; otherwise fall back to a sensible default based on the
 * source path. Slice #50 will replace this with frontmatter-driven titles.
 */
function titleFromPage(page: HtmlPage, fallback: string): string {
  // The rendered HTML wraps headings in <a class="heading-anchor">, so
  // strip tags before reading inner text.
  const m = page.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (!m) return fallback
  const text = m[1]!.replace(/<[^>]+>/g, '').trim()
  return text || fallback
}

/**
 * Convert a clean URL (`/`, `/docs/install/`) to the on-disk filesystem
 * path under outDir. The site root maps to `<outDir>/index.html`; clean URLs
 * map to `<outDir>/<segments>/index.html`.
 */
function outputPathForUrl(outDir: string, url: string): string {
  // Strip leading slash; collapse trailing slash to nothing for path join.
  const trimmed = url.replace(/^\/+/, '').replace(/\/+$/, '')
  if (trimmed === '') return path.join(outDir, 'index.html')
  return path.join(outDir, ...trimmed.split('/'), 'index.html')
}

export async function runBuild(opts: BuildOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()
  const projectPath = await resolveProjectPath(opts.projectName, opts.projectsRoot, cwd)

  // Load optional site config — null when the project hasn't shipped one
  // (perfectly fine for this scaffolding slice).
  let siteConfig: SiteConfig | null = null
  try {
    siteConfig = await loadSiteConfig(projectPath)
  } catch (err) {
    // Surface config errors prominently; missing config is `null`, not a
    // thrown error, so reaching here means the file existed but didn't
    // validate.
    throw err
  }

  const result = await renderProject(projectPath, siteConfig, 'build')

  // Detect bundle paths up front so we fail fast if the frontend hasn't
  // been built yet.
  const bundleEntry = await detectBundleEntry(opts.frontendDist)
  const stylesheet = await detectStylesheet(opts.frontendDist)

  await mkdir(opts.outDir, { recursive: true })

  // Build a minimal plain-link nav from the discovered pages — every page
  // gets the same nav. This is the "graceful no-JS fallback" the spec
  // mentions; the React bundle replaces #root once it hydrates.
  const navLinks: NavLink[] = result.pages.map((p) => ({
    url: p.url,
    label: titleFromPage(p, p.path),
  }))

  // Emit each page as <outDir>/<clean-url>/index.html.
  for (const page of result.pages) {
    const outPath = outputPathForUrl(opts.outDir, page.url)
    await mkdir(path.dirname(outPath), { recursive: true })
    const html = composePageHtml(page, {
      bundleEntry,
      title: titleFromPage(page, opts.projectName),
      stylesheet,
      navLinks,
    })
    await writeFile(outPath, html, 'utf-8')
  }

  // Emit per-missing-ref warnings to stderr.
  for (const ref of result.missingRefs) {
    process.stderr.write(
      `warning: ${ref.sourceDoc} references ${ref.missingPath} which does not exist on disk\n`,
    )
  }

  // Mirror non-markdown asset files to <outDir>/<source-path>.
  for (const asset of result.assets) {
    const sourceAbs = path.join(projectPath, asset.sourcePath)
    const destAbs = path.join(opts.outDir, asset.sourcePath)
    await mkdir(path.dirname(destAbs), { recursive: true })
    await copyFileSafe(sourceAbs, destAbs)
    if (opts.verbose) {
      process.stdout.write(`  asset: ${asset.sourcePath}\n`)
    }
  }

  // End-of-build summary.
  const missingCount = result.missingRefs.length
  process.stdout.write(
    `Copied ${result.assets.length} referenced assets (${missingCount} missing reference${missingCount === 1 ? '' : 's'})\n`,
  )

  // Copy the React bundle (frontend/dist/assets → <outDir>/assets).
  const bundleAssetsSrc = path.join(opts.frontendDist, 'assets')
  if (await isDir(bundleAssetsSrc)) {
    const bundleAssetsDest = path.join(opts.outDir, 'assets')
    await mkdir(bundleAssetsDest, { recursive: true })
    await copyDirContents(bundleAssetsSrc, bundleAssetsDest)
  }

  // baseUrl is accepted but not yet emitted — slice #50/#54 wire it into
  // canonical URLs and sitemap.xml. Touching it here keeps the option in
  // the public surface so the CLI flag stays valid.
  void opts.baseUrl
}

async function copyFileSafe(src: string, dest: string): Promise<void> {
  const buf = await readFile(src)
  await writeFile(dest, buf)
}

async function copyDirContents(src: string, dest: string): Promise<void> {
  // Use fs.cp recursively. Node 16.7+ supports it; we require >=20.
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await mkdir(d, { recursive: true })
      await cp(s, d, { recursive: true })
    } else {
      await cp(s, d)
    }
  }
}
