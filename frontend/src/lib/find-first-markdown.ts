import type { FileNode } from "@/hooks/use-projects"

function isMarkdownPath(p: string): boolean {
  return p.endsWith(".md") || p.endsWith(".markdown")
}

// Depth-first walk that returns the first markdown file under `nodes`.
// (Old behaviour — preserved here only to make the new test fail RED.)
export function findFirstMarkdown(nodes: FileNode[]): FileNode | null {
  for (const n of nodes) {
    if (n.type === "file" && !n.isAsset && isMarkdownPath(n.path)) return n
    if (n.type === "folder" && n.children) {
      const found = findFirstMarkdown(n.children)
      if (found) return found
    }
  }
  return null
}
