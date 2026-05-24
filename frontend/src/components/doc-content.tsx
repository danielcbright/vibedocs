import { useEffect, useRef, useCallback } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Copy, Check, AlertCircle, Search } from "lucide-react"
import { useState } from "react"
import { BreadcrumbNav } from "./breadcrumb-nav"
import { ConnectionStatus } from "./connection-status"
import { useTheme } from "./theme-provider"
import { useRawDocument } from "@/hooks/use-raw-document"
import { renderMermaidIn } from "@/lib/mermaid-loader"
import type { FileNode } from "@/hooks/use-projects"

interface DocContentProps {
  html: string
  loading: boolean
  error: string | null
  project: string | null
  docPath: string | null
  connected: boolean
  /** Active project's file tree, used by the breadcrumb dropdowns. */
  projectTree?: FileNode[]
  /**
   * Monotonically-increasing counter that bumps on every WebSocket reload
   * event. The hook re-fetches raw markdown when this changes so the Copy
   * button always returns the latest content.
   */
  reloadNonce?: number
  onNavigate?: (project: string, path: string) => void
  /**
   * When provided, the welcome screen renders a tappable "Search documentation"
   * button instead of the keyboard-only "Press Ctrl+K to search" hint. Used on
   * mobile where the keyboard hint is meaningless on touch devices.
   */
  mobileSearchTrigger?: () => void
}

export function DocContent({ html, loading, error, project, docPath, connected, projectTree, reloadNonce, onNavigate, mobileSearchTrigger }: DocContentProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle")
  const { resolvedTheme } = useTheme()

  const { contentRef: rawContentRef } = useRawDocument(project, docPath, reloadNonce)

  // Render mermaid diagrams after HTML is inserted. The mermaid package is
  // self-hosted (bundled as an npm dep, pinned to its own chunk via
  // `manualChunks` in vite.config.ts) and lazy-imported only when the
  // current document actually contains diagrams, so docs without diagrams
  // pay no bundle cost. Per-diagram failures degrade to a `<pre>` block —
  // see `renderMermaidIn` for the fallback behaviour.
  useEffect(() => {
    if (!html || !contentRef.current) return
    const root = contentRef.current
    let cancelled = false
    renderMermaidIn(root, { theme: resolvedTheme === "dark" ? "dark" : "default" })
      .catch((err) => {
        if (!cancelled) console.error("Mermaid render failed:", err)
      })
    return () => { cancelled = true }
  }, [html, resolvedTheme])

  // Copy uses pre-fetched content - no async fetch in the click handler
  const handleCopy = useCallback(() => {
    const text = rawContentRef.current
    if (!text) {
      setCopyState("error")
      setTimeout(() => setCopyState("idle"), 1500)
      return
    }
    try {
      // Use clipboard API (called synchronously within user gesture)
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(
          () => setCopyState("copied"),
          () => {
            // Fallback if clipboard API rejects
            copyViaTextarea(text)
            setCopyState("copied")
          }
        )
      } else {
        copyViaTextarea(text)
        setCopyState("copied")
      }
    } catch {
      setCopyState("error")
    }
    setTimeout(() => setCopyState("idle"), 1500)
    // `rawContentRef` is a stable React ref; listed to satisfy the
    // exhaustive-deps lint rule without changing handler identity.
  }, [rawContentRef])

  if (!project || !docPath) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground p-6">
        <div className="text-center">
          <h2 className="text-lg font-medium mb-1">Welcome to VibeDocs</h2>
          <p className="text-sm">Select a document from the sidebar to get started.</p>
          {mobileSearchTrigger ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-4 h-11 min-w-[160px] gap-2"
              onClick={mobileSearchTrigger}
              aria-label="Search documentation"
              data-testid="welcome-search-button"
            >
              <Search className="h-4 w-4" />
              <span>Search docs</span>
            </Button>
          ) : (
            <p className="text-xs mt-4 text-muted-foreground/60">
              Press <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-mono">Ctrl+K</kbd> to search
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <div className="flex-1 min-w-0">
          <BreadcrumbNav project={project} docPath={docPath} tree={projectTree} onNavigate={onNavigate} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 tap-target tap-active-feedback"
            onClick={handleCopy}
            title="Copy markdown"
            aria-label="Copy markdown"
          >
            {copyState === "copied" ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : copyState === "error" ? (
              <AlertCircle className="h-3.5 w-3.5 text-red-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <ConnectionStatus connected={connected} />
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 overflow-hidden">
        {/* w-full forces the inner column to fit the ScrollArea viewport
            rather than growing to its natural max-content width. Without
            this, a single wide <pre> or <table> inside the markdown stretches
            the column to its own intrinsic width and pushes the page into
            a redundant outer horizontal scroll — defeating per-element
            scroll affordances. */}
        <div className="w-full max-w-full md:max-w-[900px] mx-auto px-4 py-4 md:px-8 md:py-6">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : error ? (
            <div className="text-center text-destructive py-12">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p>{error}</p>
            </div>
          ) : (
            <div
              ref={contentRef}
              className="prose-content"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function copyViaTextarea(text: string) {
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand("copy")
  document.body.removeChild(textarea)
}
