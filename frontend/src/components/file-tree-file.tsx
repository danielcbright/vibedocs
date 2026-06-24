import { File, FileText, Image } from "lucide-react"
import {
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { isImageFile } from "@/lib/file-types"
import type { FileNode } from "@/hooks/use-projects"

/**
 * A single file row in the tree. Picks an icon (markdown / image / generic
 * asset), shows the full path in a tooltip, and on click either opens an asset
 * in a new tab (served by `/api/file/...`) or navigates to a rendered doc.
 */
export function FileTreeFile({
  node,
  project,
  activePath,
  onNavigate,
}: {
  node: FileNode
  project: string
  activePath: string | null
  onNavigate: (project: string, path: string) => void
}) {
  const isActive = activePath === node.path
  const isAsset = node.isAsset === true

  let FileIcon = FileText
  if (isAsset) {
    FileIcon = isImageFile(node.name) ? Image : File
  }

  const handleFileClick = () => {
    if (isAsset) {
      const encodedPath = node.path.split("/").map(encodeURIComponent).join("/")
      window.open(
        `/api/file/${encodeURIComponent(project)}/${encodedPath}`,
        "_blank",
      )
    } else {
      onNavigate(project, node.path)
    }
  }

  return (
    <SidebarMenuSubItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuSubButton
            isActive={isActive}
            className="cursor-pointer text-xs h-6 tap-row tap-active-feedback"
            onClick={handleFileClick}
          >
            <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{node.name}</span>
          </SidebarMenuSubButton>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {node.path}
        </TooltipContent>
      </Tooltip>
    </SidebarMenuSubItem>
  )
}
