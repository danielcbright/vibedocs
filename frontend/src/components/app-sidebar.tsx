import { useState, useMemo } from "react"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { BookOpen, ChevronRight, File, Folder, Search } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import type { ProjectInfo, FileNode } from "@/hooks/use-projects"

interface AppSidebarProps {
  projects: ProjectInfo[]
  activeProject: string | null
  activePath: string | null
  onNavigate: (project: string, path: string) => void
}

function matchesFilter(node: FileNode, filter: string): boolean {
  const lower = filter.toLowerCase()
  if (node.name.toLowerCase().includes(lower)) return true
  if (node.path.toLowerCase().includes(lower)) return true
  if (node.children) {
    return node.children.some((c) => matchesFilter(c, filter))
  }
  return false
}

function FileTreeItem({
  node,
  project,
  activePath,
  filter,
  onNavigate,
  depth,
}: {
  node: FileNode
  project: string
  activePath: string | null
  filter: string
  onNavigate: (project: string, path: string) => void
  depth: number
}) {
  const [open, setOpen] = useState(false)

  // Auto-expand if active file is inside this folder, or if filtering
  const shouldAutoExpand = useMemo(() => {
    if (filter && matchesFilter(node, filter)) return true
    if (activePath && node.type === "folder" && activePath.startsWith(node.path + "/")) return true
    return false
  }, [filter, activePath, node])

  const isOpen = open || shouldAutoExpand

  if (node.type === "folder") {
    if (filter && !matchesFilter(node, filter)) return null

    return (
      <Collapsible open={isOpen} onOpenChange={setOpen}>
        <SidebarMenuSubItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuSubButton className="cursor-pointer text-xs h-6">
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
                  depth={depth + 1}
                />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuSubItem>
      </Collapsible>
    )
  }

  // File node
  if (filter && !matchesFilter(node, filter)) return null

  const isActive = activePath === node.path

  return (
    <SidebarMenuSubItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuSubButton
            isActive={isActive}
            className="cursor-pointer text-xs h-6"
            onClick={() => onNavigate(project, node.path)}
          >
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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

export function AppSidebar({ projects, activeProject, activePath, onNavigate }: AppSidebarProps) {
  const [filter, setFilter] = useState("")

  return (
    <div className="h-full flex flex-col border-r bg-sidebar text-sidebar-foreground overflow-hidden">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-sidebar-primary" />
            <span className="font-semibold text-sm">VibeDocs</span>
          </div>
          <ThemeToggle />
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter files..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {projects.map((project) => {
          // If filtering, skip projects with no matches
          if (filter && !project.tree.some((n) => matchesFilter(n, filter))) {
            return null
          }

          const isProjectActive = activeProject === project.name
          const defaultOpen = isProjectActive || !!filter

          return (
            <Collapsible key={project.name} defaultOpen={defaultOpen}>
              <SidebarGroup className="p-1 px-2">
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel className="cursor-pointer hover:bg-sidebar-accent rounded-md transition-colors h-7">
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
                              depth={0}
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
        })}
      </SidebarContent>
    </div>
  )
}
