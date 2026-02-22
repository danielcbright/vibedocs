import { useState, useCallback, useEffect } from "react"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { usePanelRef } from "react-resizable-panels"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/components/theme-provider"
import { AppSidebar } from "@/components/app-sidebar"
import { DocContent } from "@/components/doc-content"
import { TocPanel } from "@/components/toc-panel"
import { SearchDialog } from "@/components/search-dialog"
import { useProjects } from "@/hooks/use-projects"
import { useDocument } from "@/hooks/use-document"
import { useWebSocket } from "@/hooks/use-websocket"

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

function DocsApp() {
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [activePath, setActivePath] = useState<string | null>(null)
  const { projects, refresh: refreshProjects } = useProjects()
  const { html, toc, loading, error, refresh: refreshDoc } = useDocument(activeProject, activePath)
  const sidebarPanelRef = usePanelRef()

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

  // Ctrl+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
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
  }, [sidebarPanelRef])

  // WebSocket live reload
  const { connected } = useWebSocket({
    onReload: useCallback(() => {
      refreshDoc()
    }, [refreshDoc]),
    onRefreshTree: useCallback(() => {
      refreshProjects()
    }, [refreshProjects]),
  })

  const hasToc = toc.length >= 2

  return (
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
          />
        </ResizablePanel>
        <ResizableHandle withHandle />

        {/* Main content */}
        <ResizablePanel id="content" defaultSize="62%" minSize="30%">
          <div className="flex flex-col h-full min-w-0 overflow-hidden">
            <header className="flex h-12 items-center gap-2 border-b px-4 shrink-0">
              <span className="text-sm text-muted-foreground">
                {activeProject ? `${activeProject}` : "Documentation"}
              </span>
            </header>
            <DocContent
              html={html}
              loading={loading}
              error={error}
              project={activeProject}
              docPath={activePath}
              connected={connected}
              onNavigate={navigate}
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
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <DocsApp />
        <SearchDialog onNavigate={(project, path) => {
          window.location.hash = `${project}/${path}`
        }} />
      </TooltipProvider>
    </ThemeProvider>
  )
}
