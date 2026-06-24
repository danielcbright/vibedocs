// "Edit on GitHub" footer link for `vibedocs build` (issue #55).
//
// Pure string logic. Given the project's `editOnGitHub` config and a page's
// project-relative source path, compose the GitHub edit URL:
//
//   https://github.com/{repo}/edit/{branch}/{rootPath}/{docPath}
//
// `rootPath` is where the docs live inside the repo (the offset from the repo
// root to the project root vibedocs scanned). An empty or "." rootPath means
// the docs sit at the repo root, so no extra path segment is emitted.
//
// Config-driven only — no env-var fallbacks, no `git remote` auto-detection.
// When `siteConfig.editOnGitHub` is absent, `runBuild` never calls this and
// the footer link isn't rendered.

import type { SiteConfig } from '../shared/site-config-types.js'

export type EditOnGitHubConfig = NonNullable<SiteConfig['editOnGitHub']>

/** Strip leading/trailing slashes so segments join cleanly. */
function trimSlashes(s: string): string {
  return s.replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Compose the GitHub edit URL for one page's source markdown.
 *
 * @param config   the project's `editOnGitHub` config (repo/branch/rootPath)
 * @param docPath  the page's project-relative source path (e.g. `docs/install.md`)
 */
export function resolveEditUrl(config: EditOnGitHubConfig, docPath: string): string {
  const repo = trimSlashes(config.repo)
  const branch = trimSlashes(config.branch)
  const root = trimSlashes(config.rootPath)
  const doc = trimSlashes(docPath)
  // "." or "" rootPath → docs live at the repo root; drop the segment.
  const segments = [root === '.' ? '' : root, doc].filter((s) => s !== '')
  return `https://github.com/${repo}/edit/${branch}/${segments.join('/')}`
}
