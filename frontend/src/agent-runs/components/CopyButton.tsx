import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

export function CopyButton({ value, label, className, title = "Copy" }: {
  value: string | (() => string)
  label?: string
  className?: string
  title?: string
}) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard?.writeText(typeof value === "function" ? value() : value)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span>{done ? "Copied" : label}</span>}
    </button>
  )
}
