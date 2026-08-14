import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { QUICK_FILTERS, type QuickFilter } from "./lib/filter-events"

export function FilterBar({ query, onQueryChange, quick, onQuickChange, shown, total }: {
  query: string
  onQueryChange: (q: string) => void
  quick: QuickFilter
  onQuickChange: (q: QuickFilter) => void
  shown: number
  total: number
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Filter this run…"
        aria-label="Filter this run"
        className="h-8 w-56 text-xs"
      />
      <div className="flex items-center rounded-md border text-[11px] overflow-hidden">
        {QUICK_FILTERS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={quick === k}
            onClick={() => onQuickChange(k)}
            className={cn(
              "px-2.5 py-1 capitalize transition-colors",
              quick === k ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {k}
          </button>
        ))}
      </div>
      <span className="ml-auto text-[11.5px] text-muted-foreground">
        {shown === total ? `${total} events` : `${shown} of ${total}`}
      </span>
    </div>
  )
}
