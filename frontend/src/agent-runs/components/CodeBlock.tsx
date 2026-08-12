import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { CopyButton } from "./CopyButton"

/**
 * Tool output with copy and a wrap toggle.
 *
 * Highlighting comes from the SERVER, fetched lazily when this mounts — which
 * only happens when a row is expanded. The project adds no client-side
 * highlighter, and output can be 256 KB, so highlighting every row eagerly
 * would pay for output nobody reads. Plain preformatted text is the fallback
 * and renders immediately, so the block is never blank while the fetch is in
 * flight.
 */
export function CodeBlock({ code, highlightUrl, maxHeight = 360, className }: {
  code: string
  /** When given, GET it for pre-highlighted HTML. Falls back to plain text. */
  highlightUrl?: string
  maxHeight?: number
  className?: string
}) {
  const [wrap, setWrap] = useState(false)
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!highlightUrl) return
    let cancelled = false
    fetch(highlightUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && typeof body?.data?.html === "string" && body.data.html) setHtml(body.data.html)
      })
      .catch(() => {}) // plain text is already on screen; a failure changes nothing
    return () => { cancelled = true }
  }, [highlightUrl])

  return (
    <div className={cn("group/code relative rounded-md border bg-muted/40", className)}>
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/code:opacity-100">
        <button
          type="button"
          onClick={() => setWrap((w) => !w)}
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {wrap ? "nowrap" : "wrap"}
        </button>
        <CopyButton value={code} title="Copy output" />
      </div>
      <div
        className={cn(
          "overflow-auto p-3 font-mono text-[12.5px] leading-[1.55]",
          wrap && "[&_pre]:whitespace-pre-wrap [&_code]:break-all",
        )}
        style={{ maxHeight }}
      >
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className={cn("m-0", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>{code}</pre>
        )}
      </div>
    </div>
  )
}
