import { useState, useRef, useCallback, useEffect } from "react"
import {
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Search, Upload } from "lucide-react"
import { VibedocsLogo } from "@/components/vibedocs-logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { type UploadStatus } from "@/components/file-tree-item"
import { SiteNavSections } from "@/components/site-nav-sections"
import { ProjectTreeGroup } from "@/components/project-tree-group"
import { matchesFilter } from "@/lib/file-tree-filter"
import { uploadFiles } from "@/lib/upload-files"
import type { ProjectInfo } from "@/hooks/use-projects"

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
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null)
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

  // When the active project ships a curated site nav, the file-tree filter
  // input is meaningless (we're not rendering a tree). Hide it so the sidebar
  // chrome matches what the user is actually looking at.
  const activeProjectHasSiteNav = !!projects.find(
    (p) => p.name === activeProject,
  )?.siteConfig?.nav

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
        {!activeProjectHasSiteNav && (
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
        )}
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
          // Site-nav mode: when a project ships `.vibedocs.config.ts` with a
          // `nav` field, render the curated sections instead of the discovered
          // file tree. The filter input above still renders (so it's available
          // for other projects), but it doesn't apply here — curated nav is
          // already short by design.
          if (project.siteConfig?.nav) {
            return (
              <SiteNavSections
                key={project.name}
                project={project}
                activePath={activeProject === project.name ? activePath : null}
                onNavigate={onNavigate}
              />
            )
          }

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
            <ProjectTreeGroup
              key={project.name}
              project={project}
              isOpen={isOpen}
              isProjectActive={isProjectActive}
              activePath={activePath}
              filter={filter}
              onNavigate={onNavigate}
              onOpenChange={(open) => handleProjectOpenChange(project.name, open)}
              onUploadStatus={setUploadStatus}
              uploadEnabled={uploadEnabled}
            />
          )
        })}
      </SidebarContent>
    </div>
  )
}
