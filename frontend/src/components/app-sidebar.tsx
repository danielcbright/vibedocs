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
import { ChevronRight, File, FileText, Folder, Image, Search, Upload } from "lucide-react"
import { VibedocsLogo } from "@/components/vibedocs-logo"
import { ThemeToggle } from "@/components/theme-toggle"
import type { ProjectInfo, FileNode } from "@/hooks/use-projects"

type ViewMode = "docs" | "all"

interface AppSidebarProps {
  projects: ProjectInfo[]
  activeProject: string | null
  activePath: string | null
  onNavigate: (project: string, path: string) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  /** Click handler for the brand logo in the sidebar header — typically
   *  "go home and open search palette". When omitted, the logo is non-interactive. */
  onLogoClick?: () => void
  /** When false, all upload UI is hidden. Server returns 404 to upload
   *  requests in read-only or no-token-configured deployments; this
   *  matches the visible affordances to the server's actual behavior. */
  uploadEnabled?: boolean
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
  const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(`/api/upload/${encodeURIComponent(project)}/${encodedPath}`, {
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
    return node.children.some((c) => matchesFilter(c, lower))
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
  uploadEnabled,
}: {
  node: FileNode
  project: string
  activePath: string | null
  filter: string
  onNavigate: (project: string, path: string) => void
  onUploadStatus: (status: { message: string; type: "success" | "error" }) => void
  depth: number
  uploadEnabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [userClosed, setUserClosed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-expand if active file is inside this folder, or if filtering
  const shouldAutoExpand = useMemo(() => {
    if (filter && matchesFilter(node, filter)) return true
    if (activePath && node.type === "folder" && activePath.startsWith(node.path + "/")) return true
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

  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value)
    if (!value && shouldAutoExpand) {
      setUserClosed(true)
    }
  }, [shouldAutoExpand])

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    try {
      const result = await uploadFiles(project, node.path, files)
      const count = result.data?.length ?? files.length
      onUploadStatus({ message: `Uploaded ${count} file(s) to ${node.name}`, type: "success" })
    } catch (err) {
      onUploadStatus({ message: err instanceof Error ? err.message : "Upload failed", type: "error" })
    }
    e.target.value = ""
  }, [project, node.path, node.name, onUploadStatus])

  if (node.type === "folder") {
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
      const encodedPath = node.path.split('/').map(encodeURIComponent).join('/')
      window.open(`/api/file/${encodeURIComponent(project)}/${encodedPath}`, "_blank")
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

export function AppSidebar({
  projects,
  activeProject,
  activePath,
  onNavigate,
  viewMode,
  onViewModeChange,
  onLogoClick,
  uploadEnabled = false,
}: AppSidebarProps) {
  const [filter, setFilter] = useState("")
  const [uploadStatus, setUploadStatus] = useState<{ message: string; type: "success" | "error" } | null>(null)
  const toolbarFileInputRef = useRef<HTMLInputElement>(null)

  // Per-project user open/close overrides. Cleared for both the previous and the
  // new active project whenever activeProject changes, so navigating away and back
  // re-opens a tree the user had previously collapsed — but in-project navigation
  // (activeProject unchanged) leaves the override in place. This satisfies the
  // "don't fight the user" requirement while still auto-expanding on switch.
  const [projectOpenOverrides, setProjectOpenOverrides] = useState<Record<string, boolean>>({})
  const prevActiveProjectRef = useRef<string | null>(activeProject)

  useEffect(() => {
    if (prevActiveProjectRef.current === activeProject) return
    const previous = prevActiveProjectRef.current
    prevActiveProjectRef.current = activeProject
    setProjectOpenOverrides((prev) => {
      if (!previous && !activeProject) return prev
      const next = { ...prev }
      let changed = false
      if (previous && previous in next) {
        delete next[previous]
        changed = true
      }
      if (activeProject && activeProject in next) {
        delete next[activeProject]
        changed = true
      }
      return changed ? next : prev
    })
  }, [activeProject])

  const handleProjectOpenChange = useCallback((projectName: string, open: boolean) => {
    setProjectOpenOverrides((prev) => ({ ...prev, [projectName]: open }))
  }, [])

  // Auto-dismiss upload status after 3 seconds
  useEffect(() => {
    if (!uploadStatus) return
    const timer = setTimeout(() => setUploadStatus(null), 3000)
    return () => clearTimeout(timer)
  }, [uploadStatus])

  // Determine upload target: active project root, or first project
  const uploadTarget = activeProject || (projects.length > 0 ? projects[0].name : null)

  const handleToolbarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0 || !uploadTarget) return
    try {
      const result = await uploadFiles(uploadTarget, "", files)
      const count = result.data?.length ?? files.length
      setUploadStatus({ message: `Uploaded ${count} file(s) to ${uploadTarget}`, type: "success" })
    } catch (err) {
      setUploadStatus({ message: err instanceof Error ? err.message : "Upload failed", type: "error" })
    }
    e.target.value = ""
  }, [uploadTarget])

  // The server already filters the tree based on the active view mode (?fileType=).
  // We just render what it gave us.
  const filteredProjects = projects

  return (
    <div className="h-full flex flex-col border-r bg-sidebar text-sidebar-foreground overflow-hidden">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center justify-between">
          {onLogoClick ? (
            <button
              type="button"
              onClick={onLogoClick}
              aria-label="Go home and open search"
              className="tap-row tap-active-feedback flex items-center gap-2 rounded-md px-1 -mx-1 transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            >
              <VibedocsLogo className="h-7 w-7 shrink-0" />
              <span className="font-semibold text-sm">VibeDocs</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <VibedocsLogo className="h-7 w-7 shrink-0" />
              <span className="font-semibold text-sm">VibeDocs</span>
            </div>
          )}
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
            // text-base (16px) on touch suppresses iOS auto-zoom on focus.
            // h-11 keeps the input >= 44px so it's a real tap target.
            // Desktop keeps text-xs / h-8 visual density via md: overrides.
            className="h-11 pl-8 text-base md:h-8 md:text-xs"
          />
        </div>
        {/* Toolbar: view toggle + upload */}
        <div className="flex items-center justify-between mt-2 gap-2">
          <div className="flex items-center rounded-md border border-sidebar-border text-[11px] overflow-hidden">
            <button
              type="button"
              className={`tap-target tap-active-feedback px-2.5 py-1 transition-colors ${
                viewMode === "docs"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-sidebar-foreground"
              }`}
              onClick={() => onViewModeChange("docs")}
            >
              Docs
            </button>
            <button
              type="button"
              className={`tap-target tap-active-feedback px-2.5 py-1 transition-colors ${
                viewMode === "all"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-sidebar-foreground"
              }`}
              onClick={() => onViewModeChange("all")}
            >
              All
            </button>
          </div>
          {uploadEnabled && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="tap-target tap-active-feedback flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                    onClick={() => toolbarFileInputRef.current?.click()}
                    disabled={!uploadTarget}
                    aria-label="Upload files"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {uploadTarget ? `Upload to ${uploadTarget}` : "No project selected"}
                </TooltipContent>
              </Tooltip>
              <input
                ref={toolbarFileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleToolbarUpload}
              />
            </>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {filteredProjects.map((project) => {
          // If filtering, skip projects with no matches
          if (filter && !project.tree.some((n) => matchesFilter(n, filter))) {
            return null
          }

          const isProjectActive = activeProject === project.name
          const autoExpand = isProjectActive || !!filter
          const override = projectOpenOverrides[project.name]
          // While a filter is active, every matching project must stay expanded
          // — user overrides are ignored to preserve filter semantics. Otherwise
          // an explicit override (if any) wins over the auto-expand default.
          const isOpen = filter ? autoExpand : override !== undefined ? override : autoExpand

          return (
            <Collapsible
              key={project.name}
              open={isOpen}
              onOpenChange={(open) => handleProjectOpenChange(project.name, open)}
            >
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
                              onUploadStatus={setUploadStatus}
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
        })}
      </SidebarContent>
    </div>
  )
}
