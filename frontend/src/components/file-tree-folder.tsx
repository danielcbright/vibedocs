import { useState, useMemo, useRef, useCallback, useEffect } from "react"
import {
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ChevronRight, Folder, Upload } from "lucide-react"
import { matchesFilter } from "@/lib/file-tree-filter"
import { uploadFiles } from "@/lib/upload-files"
import { FileTreeItem } from "@/components/file-tree-item"
import type { UploadStatus } from "@/components/file-tree-item"
import type { FileNode } from "@/hooks/use-projects"

/**
 * A folder row in the tree. Owns its own collapse state machine:
 *
 * - Auto-expands when the active file lives inside it, or when a filter is
 *   active and this subtree matches.
 * - `userClosed` lets an explicit collapse override the auto-expand, but it
 *   resets when the auto-expand *reason* changes (e.g. navigating to a file in
 *   this folder) so navigation re-reveals the target.
 *
 * Also hosts the per-folder upload affordance (hover-revealed on desktop,
 * always tappable on touch) and recurses into children via `FileTreeItem`.
 */
export function FileTreeFolder({
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
  const [open, setOpen] = useState(false)
  const [userClosed, setUserClosed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-expand if active file is inside this folder, or if filtering
  const shouldAutoExpand = useMemo(() => {
    if (filter && matchesFilter(node, filter)) return true
    if (activePath && activePath.startsWith(node.path + "/")) return true
    return false
  }, [filter, activePath, node])

  // Reset userClosed when the auto-expand reason changes (e.g. navigated to a different file)
  const prevAutoExpand = useRef(shouldAutoExpand)
  useEffect(() => {
    if (shouldAutoExpand && !prevAutoExpand.current) {
      setUserClosed(false)
    }
    prevAutoExpand.current = shouldAutoExpand
  }, [shouldAutoExpand])

  const isOpen = open || (shouldAutoExpand && !userClosed)

  const handleOpenChange = useCallback(
    (value: boolean) => {
      setOpen(value)
      if (!value && shouldAutoExpand) {
        setUserClosed(true)
      }
    },
    [shouldAutoExpand],
  )

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return
      try {
        const result = await uploadFiles(project, node.path, files)
        const count = result.data?.length ?? files.length
        onUploadStatus({
          message: `Uploaded ${count} file(s) to ${node.name}`,
          type: "success",
        })
      } catch (err) {
        onUploadStatus({
          message: err instanceof Error ? err.message : "Upload failed",
          type: "error",
        })
      }
      e.target.value = ""
    },
    [project, node.path, node.name, onUploadStatus],
  )

  if (filter && !matchesFilter(node, filter)) return null

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <SidebarMenuSubItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuSubButton className="group/folder cursor-pointer text-xs h-6 tap-row tap-active-feedback">
            <ChevronRight
              className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="truncate">{node.name}</span>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {node.path}
              </TooltipContent>
            </Tooltip>
            {uploadEnabled && (
              <>
                <button
                  type="button"
                  // `.tap-visible-on-touch` overrides opacity-0 on touch so
                  // there's no hover dependency. `.tap-target` gives it 44×44.
                  className="ml-auto opacity-0 group-hover/folder:opacity-100 transition-opacity p-0.5 rounded hover:bg-sidebar-accent tap-target tap-visible-on-touch tap-active-feedback"
                  onClick={(e) => {
                    e.stopPropagation()
                    fileInputRef.current?.click()
                  }}
                  aria-label={`Upload files to ${node.name}`}
                >
                  <Upload className="h-3 w-3 text-muted-foreground" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleUpload}
                />
              </>
            )}
          </SidebarMenuSubButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {node.children?.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                project={project}
                activePath={activePath}
                filter={filter}
                onNavigate={onNavigate}
                onUploadStatus={onUploadStatus}
                depth={depth + 1}
                uploadEnabled={uploadEnabled}
              />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  )
}
