import { useState } from "react"
import { cn } from "@/lib/utils"
import { CopyButton } from "./CopyButton"

/**
 * Preformatted tool output with copy and a wrap toggle.
 *
 * Deliberately unhighlighted: the project renders markdown server-side and adds
 * no client-side highlighter. Server-side highlighting of tool output is a
 * separate, lazy concern.
 */
export function CodeBlock({ code, maxHeight = 360, className }: {
  code: string
  maxHeight?: number
  className?: string
}) {
  const [wrap, setWrap] = useState(false)
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
      <div className="overflow-auto p-3 font-mono text-[12.5px] leading-[1.55]" style={{ maxHeight }}>
        <pre className={cn("m-0", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>{code}</pre>
      </div>
    </div>
  )
}
