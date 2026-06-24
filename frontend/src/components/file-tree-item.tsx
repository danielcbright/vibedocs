import { FileTreeFile } from "@/components/file-tree-file"
import { FileTreeFolder } from "@/components/file-tree-folder"
import { matchesFilter } from "@/lib/file-tree-filter"
import type { FileNode } from "@/hooks/use-projects"

export type UploadStatus = { message: string; type: "success" | "error" }

/**
 * Dispatcher for a single tree node: folders render the collapsible
 * `FileTreeFolder` (which recurses back through this dispatcher), files render
 * the leaf `FileTreeFile`. Folder filtering is handled inside `FileTreeFolder`;
 * files that don't match the active filter are skipped here.
 */
export function FileTreeItem({
  node,
  project,
  activePath,
  filter,
  onNavigate,
  onUploadStatus,
  depth,
  uploadEnabled,
}: {
  node: FileNode
  project: string
  activePath: string | null
  filter: string
  onNavigate: (project: string, path: string) => void
  onUploadStatus: (status: UploadStatus) => void
  depth: number
  uploadEnabled: boolean
}) {
  if (node.type === "folder") {
    return (
      <FileTreeFolder
        node={node}
        project={project}
        activePath={activePath}
        filter={filter}
        onNavigate={onNavigate}
        onUploadStatus={onUploadStatus}
        depth={depth}
        uploadEnabled={uploadEnabled}
      />
    )
  }

  if (filter && !matchesFilter(node, filter)) return null

  return (
    <FileTreeFile
      node={node}
      project={project}
      activePath={activePath}
      onNavigate={onNavigate}
    />
  )
}
