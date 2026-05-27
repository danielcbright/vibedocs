import type { FileNode } from "@/hooks/use-projects"

/**
 * Recursively counts the markdown files in a project tree, excluding assets
 * and non-markdown files. Used to render "N docs" subtitles in the picker.
 */
export function countMarkdownDocs(nodes: FileNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (
      node.type === "file" &&
      !node.isAsset &&
      (node.path.endsWith(".md") || node.path.endsWith(".markdown"))
    ) {
      count += 1
    }
    if (node.type === "folder" && node.children) {
      count += countMarkdownDocs(node.children)
    }
  }
  return count
}
