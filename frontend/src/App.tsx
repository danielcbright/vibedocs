import { useState, useCallback, useEffect } from "react"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { usePanelRef } from "react-resizable-panels"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Menu, Search } from "lucide-react"
import { VibedocsLogo } from "@/components/vibedocs-logo"
import { ThemeProvider } from "@/components/theme-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { AppSidebar } from "@/components/app-sidebar"
import { ProjectSwitcher } from "@/components/project-switcher"
import { DocContent } from "@/components/doc-content"
import { TocPanel } from "@/components/toc-panel"
import { MobileToc } from "@/components/mobile-toc"
import { SearchDialog } from "@/components/search-dialog"
import { useProjects, type FileTypeFilter, type FileNode } from "@/hooks/use-projects"
import { useDocument } from "@/hooks/use-document"
import { useWebSocket } from "@/hooks/use-websocket"
import { useIsMobile } from "@/hooks/use-mobile"
import { useConfig } from "@/hooks/use-config"
import { findFirstMarkdown } from "@/lib/find-first-markdown"

function parseHash(): { project: string | null; path: string | null } {
  const hash = window.location.hash.slice(1)
  if (!hash) return { project: null, path: null }
  const slashIndex = hash.indexOf("/")
  if (slashIndex === -1) return { project: hash, path: null }
  return {
    project: hash.slice(0, slashIndex),
    path: hash.slice(slashIndex + 1),
  }
}

function isMarkdownPath(p: string): boolean {
  return p.endsWith(".md") || p.endsWith(".markdown")
}

// Find a node by its exact path in the tree, or null if not present.
function findNodeAt(nodes: FileNode[], path: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.type === "folder" && n.children) {
      const found = findNodeAt(n.children, path)
      if (found) return found
    }
  }
  return null
}

type ViewMode = "docs" | "all"

const VIEW_MODE_TO_FILE_TYPE: Record<ViewMode, FileTypeFilter> = {
  docs: "markdown",
  all: "all",
}

function DocsApp() {
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>("docs")
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { projects, refresh: refreshProjects } = useProjects(VIEW_MODE_TO_FILE_TYPE[viewMode])
  const { uploadEnabled } = useConfig()
  const { html, toc, loading, error, refresh: refreshDoc } = useDocument(activeProject, activePath)
  const sidebarPanelRef = usePanelRef()
  const isMobile = useIsMobile()

  // Parse hash on mount and on hash change
  useEffect(() => {
    const onHash = () => {
      const { project, path } = parseHash()
      setActiveProject(project)
      setActivePath(path)
    }
    onHash()
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const navigate = useCallback((project: string, path: string) => {
    window.location.hash = `${project}/${path}`
  }, [])

  // Tree of the currently-active project — passed to DocContent so the
  // breadcrumb dropdowns can list folder contents.
  const activeProjectTree = activeProject
    ? projects.find((p) => p.name === activeProject)?.tree ?? []
    : []

  // Resolves a navigation target. Files navigate directly. Empty/folder paths
  // resolve to the first markdown file under that scope so breadcrumb clicks
  // ("vibedocs", "docs") land on a real doc instead of a 400 from the renderer.
  const navigateSmart = useCallback((project: string, path: string) => {
    if (path && isMarkdownPath(path)) {
      navigate(project, path)
      return
    }
    const proj = projects.find((p) => p.name === project)
    if (proj) {
      const scope = path ? findNodeAt(proj.tree, path)?.children ?? null : proj.tree
      if (scope) {
        const first = findFirstMarkdown(scope)
        if (first) {
          navigate(project, first.path)
          return
        }
      }
    }
    // Couldn't resolve — fall through (will likely render an error, but URL is consistent)
    navigate(project, path)
  }, [navigate, projects])

  // On mobile, navigation should also close the drawer
  const navigateAndCloseDrawer = useCallback((project: string, path: string) => {
    navigate(project, path)
    setMobileSidebarOpen(false)
  }, [navigate])

  // Clicking the logo: go home AND open search. Closes the mobile drawer if open.
  const goHomeAndSearch = useCallback(() => {
    window.location.hash = ""
    setMobileSidebarOpen(false)
    setSearchOpen(true)
  }, [])

  // Ctrl+B toggles sidebar: mobile drawer when on mobile, resizable panel otherwise
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (isMobile) {
          setMobileSidebarOpen((prev) => !prev)
          return
        }
        const panel = sidebarPanelRef.current
        if (panel) {
          if (panel.isCollapsed()) {
            panel.expand()
          } else {
            panel.collapse()
          }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [sidebarPanelRef, isMobile])

  // WebSocket live reload
  const { connected } = useWebSocket({
    onReload: useCallback(() => {
      refreshDoc()
      setReloadNonce((n) => n + 1)
    }, [refreshDoc]),
    onRefreshTree: useCallback(() => {
      refreshProjects()
    }, [refreshProjects]),
  })

  const hasToc = toc.length >= 2

  if (isMobile) {
    return (
      <>
        <div className="flex flex-col" style={{ height: "100dvh", overflow: "hidden" }}>
          <header className="flex h-14 items-center gap-2 border-b px-3 shrink-0 bg-background">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              aria-label="Open navigation menu"
              data-testid="mobile-menu-trigger"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <button
              type="button"
              onClick={goHomeAndSearch}
              aria-label="Go home and open search"
              className="tap-row tap-active-feedback flex items-center gap-2 min-w-0 flex-1 rounded-md px-1 -mx-1 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <VibedocsLogo className="h-7 w-7 shrink-0" />
              <span className="font-semibold text-sm truncate">
                {activeProject ?? "VibeDocs"}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              aria-label="Search documentation"
              data-testid="mobile-search-trigger"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-5 w-5" />
            </Button>
            <ThemeToggle />
          </header>
          <div className="flex-1 min-h-0 overflow-hidden">
            <DocContent
              html={html}
              loading={loading}
              error={error}
              project={activeProject}
              docPath={activePath}
              connected={connected}
              projectTree={activeProjectTree}
              projects={projects}
              reloadNonce={reloadNonce}
              onNavigate={navigateSmart}
              mobileSearchTrigger={() => setSearchOpen(true)}
            />
          </div>
        </div>
        {hasToc ? <MobileToc toc={toc} /> : null}
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent
            side="left"
            className="w-[85vw] sm:max-w-sm p-0 bg-sidebar-background text-sidebar-foreground [&>button]:hidden"
            data-testid="mobile-sidebar-sheet"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Project list and file tree.</SheetDescription>
            </SheetHeader>
            <AppSidebar
              projects={projects}
              activeProject={activeProject}
              activePath={activePath}
              onNavigate={navigateAndCloseDrawer}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onLogoClick={goHomeAndSearch}
              uploadEnabled={uploadEnabled}
            />
          </SheetContent>
        </Sheet>
        <SearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onNavigate={(project, path) => {
            window.location.hash = `${project}/${path}`
          }}
        />
        <ProjectSwitcher
          projects={projects}
          activeProject={activeProject}
          onNavigate={navigateSmart}
        />
      </>
    )
  }

  return (
    <>
      <div style={{ height: "100vh", overflow: "hidden" }}>
        <ResizablePanelGroup direction="horizontal">
          {/* Sidebar */}
          <ResizablePanel
            id="sidebar"
            panelRef={sidebarPanelRef}
            defaultSize="18%"
            minSize={150}
            maxSize="30%"
            collapsible
          >
            <AppSidebar
              projects={projects}
              activeProject={activeProject}
              activePath={activePath}
              onNavigate={navigate}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onLogoClick={goHomeAndSearch}
              uploadEnabled={uploadEnabled}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />

          {/* Main content */}
          <ResizablePanel id="content" defaultSize="62%" minSize="30%">
            <div className="flex flex-col h-full min-w-0 overflow-hidden">
              <header className="flex h-12 items-center gap-2 border-b px-4 shrink-0">
                <ProjectSwitcher
                  projects={projects}
                  activeProject={activeProject}
                  onNavigate={navigateSmart}
                  inline
                />
              </header>
              <DocContent
                html={html}
                loading={loading}
                error={error}
                project={activeProject}
                docPath={activePath}
                connected={connected}
                projectTree={activeProjectTree}
                projects={projects}
                reloadNonce={reloadNonce}
                onNavigate={navigateSmart}
              />
            </div>
          </ResizablePanel>
          <ResizableHandle />

          {/* TOC - always rendered, content conditional */}
          <ResizablePanel id="toc" defaultSize="20%" minSize={120} maxSize="30%">
            {hasToc ? <TocPanel toc={toc} /> : null}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onNavigate={(project, path) => {
          window.location.hash = `${project}/${path}`
        }}
      />
    </>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <DocsApp />
      </TooltipProvider>
    </ThemeProvider>
  )
}
