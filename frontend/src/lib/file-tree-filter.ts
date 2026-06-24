import type { FileNode } from "@/hooks/use-projects"

/**
 * True when `node` — or any descendant — matches the (case-insensitive)
 * `filter` text against its name or path. Drives both the "should this row
 * render" decision and the auto-expand-on-filter behaviour in the file tree.
 */
export function matchesFilter(node: FileNode, filter: string): boolean {
  const lower = filter.toLowerCase()
  if (node.name.toLowerCase().includes(lower)) return true
  if (node.path.toLowerCase().includes(lower)) return true
  if (node.children) {
    return node.children.some((c) => matchesFilter(c, lower))
  }
  return false
}
