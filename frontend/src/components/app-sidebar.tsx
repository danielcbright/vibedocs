import { useState, useMemo, useRef, useCallback, useEffect } from "react"
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
import { BookOpen, ChevronRight, File, FileText, Folder, Image, Search, Upload } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import type { ProjectInfo, FileNode } from "@/hooks/use-projects"

interface AppSidebarProps {
  projects: ProjectInfo[]
  activeProject: string | null
  activePath: string | null
  onNavigate: (project: string, path: string) => void
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"])

function isImageFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

async function uploadFiles(project: string, folderPath: string, files: FileList) {
  const formData = new FormData()
  for (const file of Array.from(files)) {
    formData.append('files', file)
  }
  const res = await fetch(`/api/upload/${encodeURIComponent(project)}/${folderPath}`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }))
    throw new Error(err.error || 'Upload failed')
  }
  return res.json()
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
  onUploadStatus,
  depth,
}: {
  node: FileNode
  project: string
  activePath: string | null
  filter: string
  onNavigate: (project: string, path: string) => void
  onUploadStatus: (status: { message: string; type: "success" | "error" }) => void
  depth: number
}) {
  const [open, setOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-expand if active file is inside this folder, or if filtering
  const shouldAutoExpand = useMemo(() => {
    if (filter && matchesFilter(node, filter)) return true
    if (activePath && node.type === "folder" && activePath.startsWith(node.path + "/")) return true
    return false
  }, [filter, activePath, node])

  const isOpen = open || shouldAutoExpand

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    try {
      const result = await uploadFiles(project, node.path, files)
      const count = result.data?.length ?? files.length
      onUploadStatus({ message: `Uploaded ${count} file(s)`, type: "success" })
    } catch (err) {
      onUploadStatus({ message: err instanceof Error ? err.message : "Upload failed", type: "error" })
    }
    // Reset input so the same file can be re-selected
    e.target.value = ""
  }, [project, node.path, onUploadStatus])

  if (node.type === "folder") {
    if (filter && !matchesFilter(node, filter)) return null

    return (
      <Collapsible open={isOpen} onOpenChange={setOpen}>
        <SidebarMenuSubItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuSubButton className="group/folder cursor-pointer text-xs h-6">
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
              <button
                type="button"
                className="ml-auto opacity-0 group-hover/folder:opacity-100 transition-opacity p-0.5 rounded hover:bg-sidebar-accent"
                onClick={(e) => {
                  e.stopPropagation()
                  fileInputRef.current?.click()
                }}
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
  const isAsset = node.isAsset === true

  // Determine file icon
  let FileIcon = FileText
  if (isAsset) {
    FileIcon = isImageFile(node.name) ? Image : File
  }

  const handleFileClick = () => {
    if (isAsset) {
      window.open(`/api/file/${encodeURIComponent(project)}/${node.path}`, "_blank")
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
            className="cursor-pointer text-xs h-6"
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

export function AppSidebar({ projects, activeProject, activePath, onNavigate }: AppSidebarProps) {
  const [filter, setFilter] = useState("")
  const [uploadStatus, setUploadStatus] = useState<{ message: string; type: "success" | "error" } | null>(null)

  // Auto-dismiss upload status after 3 seconds
  useEffect(() => {
    if (!uploadStatus) return
    const timer = setTimeout(() => setUploadStatus(null), 3000)
    return () => clearTimeout(timer)
  }, [uploadStatus])

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
        {uploadStatus && (
          <div
            className={`mt-2 text-xs px-2 py-1 rounded ${
              uploadStatus.type === "success"
                ? "bg-green-500/10 text-green-700 dark:text-green-400"
                : "bg-red-500/10 text-red-700 dark:text-red-400"
            }`}
          >
            {uploadStatus.message}
          </div>
        )}
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
                              onUploadStatus={setUploadStatus}
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
