import type { FileNode } from "@/hooks/use-projects"

function isMarkdownPath(p: string): boolean {
  return p.endsWith(".md") || p.endsWith(".markdown")
}

// File names that should resolve first when present at a given tree level —
// matched case-insensitively against `node.name`.
const PREFERRED_NAMES = ["readme.md", "readme.markdown", "index.md", "index.markdown"]

function isPreferredEntry(node: FileNode): boolean {
  if (node.type !== "file" || node.isAsset) return false
  return PREFERRED_NAMES.includes(node.name.toLowerCase())
}

function isMarkdownEntry(node: FileNode): boolean {
  return node.type === "file" && !node.isAsset && isMarkdownPath(node.path)
}

/**
 * Returns the most user-meaningful markdown file under `nodes`. At each tree
 * level we (a) prefer an exact case-insensitive `README.md` / `README.markdown`
 * / `index.md` / `index.markdown` match, (b) fall back to the first markdown
 * file at that level, (c) only recurse into folders when this level has no
 * markdown. This means tile-clicks land on a project's README instead of an
 * alphabetically-earlier file like CHANGELOG.md.
 */
export function findFirstMarkdown(nodes: FileNode[]): FileNode | null {
  const preferred = nodes.find(isPreferredEntry)
  if (preferred) return preferred

  const firstMarkdown = nodes.find(isMarkdownEntry)
  if (firstMarkdown) return firstMarkdown

  for (const n of nodes) {
    if (n.type === "folder" && n.children) {
      const found = findFirstMarkdown(n.children)
      if (found) return found
    }
  }
  return null
}
