import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronRight } from "lucide-react"
import { FileTreeItem, type UploadStatus } from "@/components/file-tree-item"
import type { ProjectInfo } from "@/hooks/use-projects"

/**
 * A top-level project row: a collapsible whose header is the project name and
 * whose body is the discovered file tree. The parent owns the open/close state
 * (auto-expand vs. user override) and passes the resolved `isOpen` in; this
 * component is the presentational shell plus the recursive `FileTreeItem` map.
 */
export function ProjectTreeGroup({
  project,
  isOpen,
  isProjectActive,
  activePath,
  filter,
  onNavigate,
  onOpenChange,
  onUploadStatus,
  uploadEnabled,
}: {
  project: ProjectInfo
  isOpen: boolean
  isProjectActive: boolean
  activePath: string | null
  filter: string
  onNavigate: (project: string, path: string) => void
  onOpenChange: (open: boolean) => void
  onUploadStatus: (status: UploadStatus) => void
  uploadEnabled: boolean
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <SidebarGroup className="p-1 px-2">
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel className="cursor-pointer hover:bg-sidebar-accent rounded-md transition-colors h-7 tap-row tap-active-feedback">
            <ChevronRight className="h-3 w-3 mr-1 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
            <span className="truncate">{project.name}</span>
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0">
              <SidebarMenuItem>
                <SidebarMenuSub className="gap-0 py-0">
                  {project.tree.map((node) => (
                    <FileTreeItem
                      key={node.path}
                      node={node}
                      project={project.name}
                      activePath={isProjectActive ? activePath : null}
                      filter={filter}
                      onNavigate={onNavigate}
                      onUploadStatus={onUploadStatus}
                      depth={0}
                      uploadEnabled={uploadEnabled}
                    />
                  ))}
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
