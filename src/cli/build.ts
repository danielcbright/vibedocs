// `vibedocs build` — emit a static dist/ from a project's markdown docs.
//
// Slice #49 scaffolding: walks the project, calls the pure renderer in build
// mode, writes per-page HTML using the hardcoded template, mirrors asset
// files to <out>/<source-path>, and copies the React bundle from
// frontend/dist into <out>/assets/. Later slices layer SEO meta (slice #50),
// theming (slice #51), llms.txt + raw .md.txt mirror (slice #53), sitemap
// (slice #54), edit-on-GitHub (slice #55), and Pagefind (slice #56) on top.
//
// Pure orchestration: this module owns the FS writes. The renderer
// (src/render.ts) stays pure; the template (src/cli/template.ts) stays
// string-only.

import path from 'path'
import { stat, mkdir, writeFile, readFile, readdir, cp } from 'fs/promises'
import { renderProject, type HtmlPage } from '../render.js'
import { loadSiteConfig, type SiteConfig } from '../site-config.js'
import type { HydrationPolicy } from '../shared/site-config-types.js'
import { createHash } from 'crypto'
import { resolveHydration } from './args.js'
import { composePageHtml, type NavLink } from './template.js'
import {
  buildManifest,
  resolveThemeColor,
  staticServiceWorkerSource,
  swRegisterScriptSource,
  PWA_ICON_FILES,
} from './pwa.js'
import { formatSitemap, formatRobots, normalizeBaseUrl } from './sitemap.js'
import { resolvePageSeo } from './seo.js'
import { formatLlmsTxt, type LlmsDoc } from './llms.js'

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
  /**
   * Static-build hydration policy. CLI flag wins, otherwise resolved from
   * `siteConfig.hydration`, otherwise `'full'`. When `'minimal'`, the SPA
   * bundle copy is skipped and the bootstrap `<script>` tag is omitted.
   */
  hydration?: HydrationPolicy
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

  // Resolve effective hydration policy: CLI > siteConfig > 'full'. This is the
  // single seam where the policy is decided; template + bundle-copy branches
  // below both read from this one value.
  const hydration = resolveHydration(opts.hydration, siteConfig?.hydration)

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

  // PWA install/offline metadata — derived from siteConfig where sensible,
  // injected into every page's <head> in BOTH hydration modes (#143). The
  // manifest's display title doubles as the iOS home-screen title.
  const manifest = buildManifest(siteConfig, opts.projectName)
  const themeColor = resolveThemeColor(siteConfig)
  const pwa = { themeColor, appTitle: manifest.short_name }

  // Resolve the site base URL once — used for both per-page canonical/og:url
  // (#50) and sitemap/robots (#54). Precedence: explicit `--base-url` >
  // `siteConfig.domain` > a localhost fallback so the build never fails on a
  // missing domain. `normalizeBaseUrl` makes all three forms a clean origin.
  const siteBaseUrl = normalizeBaseUrl(opts.baseUrl ?? siteConfig?.domain ?? 'localhost')

  // Doc descriptors for llms.txt — keyed by source path so the keyDocs config
  // (which lists source paths like `README.md`) can be matched. Title +
  // description reuse the same resolver that drives the page's <head>, so the
  // index can't disagree with the rendered page.
  const docsByPath = new Map<string, LlmsDoc>()

  // Emit each page as <outDir>/<clean-url>/index.html.
  for (const page of result.pages) {
    const outPath = outputPathForUrl(opts.outDir, page.url)
    await mkdir(path.dirname(outPath), { recursive: true })
    const seo = resolvePageSeo({ page, siteConfig, baseUrl: siteBaseUrl })
    docsByPath.set(page.path, {
      title: seo.title,
      url: page.url,
      ...(seo.description ? { description: seo.description } : {}),
    })
    const html = composePageHtml(page, {
      bundleEntry,
      title: seo.title,
      stylesheet,
      navLinks,
      hydration,
      pwa,
      seo,
      ...(siteConfig?.nav ? { siteConfigNav: siteConfig.nav } : {}),
    })
    await writeFile(outPath, html, 'utf-8')
  }

  // PWA assets: manifest + icon set + service worker. Emitted in both hydration
  // modes — in minimal mode the SW is the only JS the page ships, so it must be
  // self-contained. Icons come from the built frontend bundle (Vite mirrors
  // frontend/public/* into frontend/dist/) so we don't duplicate the #142 set.
  await writeFile(
    path.join(opts.outDir, 'manifest.webmanifest'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  )

  const copiedIcons: string[] = []
  for (const icon of PWA_ICON_FILES) {
    const src = path.join(opts.frontendDist, icon)
    if (await fileExists(src)) {
      await copyFileSafe(src, path.join(opts.outDir, icon))
      copiedIcons.push(icon)
    }
  }

  // SW cache version: hash of the asset list + this build's own SW/register
  // source, so a rebuild that changes any shipped byte rotates the cache name
  // and the activate handler purges the stale cache.
  const swVersion = createHash('sha256')
    .update([bundleEntry, stylesheet ?? '', ...copiedIcons].sort().join('|'))
    .digest('hex')
    .slice(0, 12)
  await writeFile(path.join(opts.outDir, 'sw.js'), staticServiceWorkerSource(swVersion), 'utf-8')
  await writeFile(path.join(opts.outDir, 'sw-register.js'), swRegisterScriptSource(), 'utf-8')

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

  // Bundle stats — used by both the copy step (full mode) and the summary
  // line (minimal mode prints "saved ~XXX KB"). Walking the dir once up-front
  // keeps the cost minimal and makes the summary honest in both modes.
  const bundleAssetsSrc = path.join(opts.frontendDist, 'assets')
  const bundleStats = (await isDir(bundleAssetsSrc))
    ? await sumDirBytes(bundleAssetsSrc)
    : { fileCount: 0, totalBytes: 0 }

  // Copy the React bundle (frontend/dist/assets → <outDir>/assets) only in
  // full-hydration mode. Minimal mode ships no SPA bundle, so the copy is
  // pure waste — and worse, the unreferenced JS/CSS would inflate the
  // published `dist/` for no benefit. EXCEPT for the single CSS file the
  // emitted `<link rel="stylesheet">` still references — Shiki tokens,
  // prose typography, and table styles all live there. The spec is explicit:
  // "Preserve the CSS link." Skipping the JS chunks but keeping the one CSS
  // bundle delivers ~99% of the savings while keeping pages looking correct.
  if (hydration === 'full' && bundleStats.fileCount > 0) {
    const bundleAssetsDest = path.join(opts.outDir, 'assets')
    await mkdir(bundleAssetsDest, { recursive: true })
    await copyDirContents(bundleAssetsSrc, bundleAssetsDest)
  } else if (hydration === 'minimal' && stylesheet) {
    // Copy ONLY the CSS file the stylesheet link references.
    const cssBasename = path.basename(stylesheet)
    const cssSrc = path.join(bundleAssetsSrc, cssBasename)
    if (await fileExists(cssSrc)) {
      const cssDest = path.join(opts.outDir, 'assets', cssBasename)
      await mkdir(path.dirname(cssDest), { recursive: true })
      await copyFileSafe(cssSrc, cssDest)
    }
  }

  // Saved-bytes math: in minimal mode we DID copy the CSS file, so the
  // honest "saved" number is bundleStats.totalBytes minus the CSS bytes.
  const cssBytesIfMinimal =
    hydration === 'minimal' && stylesheet
      ? await fileSizeOrZero(path.join(bundleAssetsSrc, path.basename(stylesheet)))
      : 0

  // Hydration summary — final line(s) of stdout. Names what was decided AND
  // makes the cost visible, so a consumer sees the tradeoff at a glance.
  if (hydration === 'full') {
    process.stdout.write(
      `Hydration policy: full (SPA bundle copied — ${bundleStats.fileCount} files, ~${humanBytes(bundleStats.totalBytes)})\n`,
    )
  } else {
    process.stdout.write(
      `Hydration policy: minimal — no SPA bundle (saved ~${humanBytes(bundleStats.totalBytes - cssBytesIfMinimal)})\n`,
    )
  }

  // SEO: sitemap.xml + robots.txt (#54). Reuses the `siteBaseUrl` resolved
  // above for per-page canonical URLs, so the sitemap and canonical tags can
  // never disagree on the origin.
  await writeFile(
    path.join(opts.outDir, 'sitemap.xml'),
    formatSitemap({ pages: result.pages, baseUrl: siteBaseUrl }),
    'utf-8',
  )
  await writeFile(
    path.join(opts.outDir, 'robots.txt'),
    formatRobots({ baseUrl: siteBaseUrl }),
    'utf-8',
  )

  // llms.txt (#53): an llmstxt.org-compliant index for LLM consumers. Only
  // emitted when the project ships a siteConfig — without one there's no site
  // name/summary/keyDocs to describe. keyDocs config entries are source paths;
  // we resolve each to its rendered doc descriptor (skipping any that don't map
  // to a real page) and pass the rest as the auto-listed `## Full docs`.
  if (siteConfig !== null) {
    const allDocs = result.pages
      .map((p) => docsByPath.get(p.path))
      .filter((d): d is LlmsDoc => d !== undefined)
    const keyDocs = siteConfig.llms.keyDocs
      .map((p) => docsByPath.get(p))
      .filter((d): d is LlmsDoc => d !== undefined)
    await writeFile(
      path.join(opts.outDir, 'llms.txt'),
      formatLlmsTxt({
        name: siteConfig.name,
        summary: siteConfig.llms.summary,
        keyDocs,
        allDocs,
        baseUrl: siteBaseUrl,
      }),
      'utf-8',
    )
  }

  // Raw markdown mirror (#53): every source `.md` is copied verbatim to
  // <out>/<source-path>.md.txt so tools/LLMs can fetch the source alongside
  // the rendered HTML (docs/install.md → docs/install.md.txt). No transforms —
  // the frontmatter and body land exactly as authored. Independent of
  // siteConfig (always emitted).
  for (const page of result.pages) {
    const src = path.join(projectPath, ...page.path.split('/'))
    const dest = path.join(opts.outDir, ...page.path.split('/')) + '.txt'
    await mkdir(path.dirname(dest), { recursive: true })
    await copyFileSafe(src, dest)
    if (opts.verbose) {
      process.stdout.write(`  raw: ${page.path}.txt\n`)
    }
  }
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

interface BundleStats {
  fileCount: number
  totalBytes: number
}

/**
 * Sum the byte size of every file under `dir` (recursively). Used to honestly
 * report "saved ~XXX KB" in minimal mode and "SPA bundle copied — N files,
 * ~XXX KB" in full mode. Same walk in both branches so the numbers match.
 */
async function sumDirBytes(dir: string): Promise<BundleStats> {
  const entries = await readdir(dir, { withFileTypes: true })
  let fileCount = 0
  let totalBytes = 0
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = await sumDirBytes(full)
      fileCount += sub.fileCount
      totalBytes += sub.totalBytes
    } else {
      const s = await stat(full)
      fileCount += 1
      totalBytes += s.size
    }
  }
  return { fileCount, totalBytes }
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}

async function fileSizeOrZero(p: string): Promise<number> {
  try {
    const s = await stat(p)
    return s.size
  } catch {
    return 0
  }
}
