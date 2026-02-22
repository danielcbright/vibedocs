import { useEffect, useRef, useCallback } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Copy, Check, AlertCircle } from "lucide-react"
import { useState } from "react"
import { BreadcrumbNav } from "./breadcrumb-nav"
import { ConnectionStatus } from "./connection-status"
import { useTheme } from "./theme-provider"

interface DocContentProps {
  html: string
  loading: boolean
  error: string | null
  project: string | null
  docPath: string | null
  connected: boolean
  onNavigate?: (project: string, path: string) => void
}

export function DocContent({ html, loading, error, project, docPath, connected, onNavigate }: DocContentProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const rawContentRef = useRef<string>("")
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle")
  const { resolvedTheme } = useTheme()

  // Pre-fetch raw markdown so it's ready when copy is clicked
  useEffect(() => {
    rawContentRef.current = ""
    if (!project || !docPath) return
    let cancelled = false
    fetch(`/api/raw/${encodeURIComponent(project)}/${docPath}`)
      .then((res) => res.text())
      .then((text) => {
        if (!cancelled) rawContentRef.current = text
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [project, docPath])

  // Initialize mermaid diagrams after HTML is inserted
  useEffect(() => {
    if (!html || !contentRef.current) return
    const mermaidDivs = contentRef.current.querySelectorAll(".mermaid")
    if (mermaidDivs.length === 0) return

    // Dynamically import mermaid
    import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")
      .then((mod) => {
        const mermaid = mod.default
        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedTheme === "dark" ? "dark" : "default",
        })
        // Reset processed state
        mermaidDivs.forEach((el) => {
          el.removeAttribute("data-processed")
        })
        mermaid.run({ nodes: mermaidDivs as unknown as ArrayLike<HTMLElement> })
      })
      .catch((err) => console.error("Mermaid init failed:", err))
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
  }, [])

  if (!project || !docPath) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="text-center">
          <h2 className="text-lg font-medium mb-1">Welcome to Docs Browser</h2>
          <p className="text-sm">Select a document from the sidebar to get started.</p>
          <p className="text-xs mt-4 text-muted-foreground/60">
            Press <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-mono">Ctrl+K</kbd> to search
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <div className="flex-1 min-w-0">
          <BreadcrumbNav project={project} docPath={docPath} onNavigate={onNavigate} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopy}
            title="Copy markdown"
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
        <div className="max-w-[900px] mx-auto px-8 py-6">
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
