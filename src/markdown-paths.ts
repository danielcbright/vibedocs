/**
 * Single source of truth for markdown file-type detection.
 *
 * Five layers consume this predicate:
 *
 * 1. **Render** (`src/render.ts`) skips non-markdown files when walking the
 *    project tree.
 * 2. **Discovery** (`src/discovery.ts`) flags non-markdown files with
 *    `isAsset: true` in the tree it ships to the frontend.
 * 3. **Search** (`src/search.ts`) only indexes markdown files.
 * 4. **Server** (`src/server.ts`) decides whether a file-system change should
 *    broadcast a `reload` (markdown content changed) or a `refresh-tree`
 *    (non-markdown affects the navigation tree).
 * 5. **URL Rewriter** (`src/url-rewriter.ts`) decides whether a link is to
 *    another page (markdown → page URL) or to an asset.
 *
 * The PathResolver in `src/server.ts` also configures its docResolver from
 * `MARKDOWN_EXTENSIONS`, so the path-validation allowlist stays in sync.
 *
 * Adding an extension here (e.g. `.mdx`) propagates to all five layers
 * automatically. Do NOT redefine this set anywhere else, and do NOT inline
 * `path.endsWith('.md')` checks in consumers.
 */

// Canonical extension list. Lower-case; matched case-insensitively by
// `isMarkdownPath`. PathResolver consumes this directly as its
// `requireExtensions` allowlist — see src/server.ts.
export const MARKDOWN_EXTENSIONS: readonly string[] = ['.md', '.markdown']

const MD_EXTENSION_RE = /\.(md|markdown)$/i

/**
 * True iff `filePath` ends with one of the canonical markdown extensions
 * (case-insensitive). Suffix-only — `archived.md.bak` does NOT match.
 *
 * Accepts any POSIX or platform-native path string; only the suffix matters.
 */
export function isMarkdownPath(filePath: string): boolean {
  return MD_EXTENSION_RE.test(filePath)
}
