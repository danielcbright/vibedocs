import { useState, useEffect } from "react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { File, Search } from "lucide-react"
import { useSearch } from "@/hooks/use-search"

interface SearchDialogProps {
  onNavigate: (project: string, path: string) => void
  /** Optional controlled open state. When provided, callers manage open/close. */
  open?: boolean
  /** Called when the dialog wants to open or close. Required if `open` is provided. */
  onOpenChange?: (open: boolean) => void
}

export function SearchDialog({ onNavigate, open: openProp, onOpenChange }: SearchDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(open) : next
    if (isControlled) {
      onOpenChange?.(resolved)
    } else {
      setInternalOpen(resolved)
      onOpenChange?.(resolved)
    }
  }
  const [query, setQuery] = useState("")
  const { results, loading } = useSearch(query)

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isControlled])

  // Group results by project
  const grouped = results.reduce<Record<string, typeof results>>((acc, r) => {
    if (!acc[r.project]) acc[r.project] = []
    acc[r.project].push(r)
    return acc
  }, {})

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search documentation..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && query.length >= 2 && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Search className="h-4 w-4 animate-pulse mx-auto mb-2" />
            Searching...
          </div>
        )}
        <CommandEmpty>
          {query.length < 2 ? "Type to search..." : "No results found."}
        </CommandEmpty>
        {Object.entries(grouped).map(([project, items]) => (
          <CommandGroup key={project} heading={project}>
            {items.map((item) => (
              <CommandItem
                key={`${item.project}/${item.path}`}
                value={`${item.project}/${item.path} ${item.snippet}`}
                onSelect={() => {
                  onNavigate(item.project, item.path)
                  setOpen(false)
                  setQuery("")
                }}
              >
                <File className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-sm truncate">{item.filename}</div>
                  <div className="text-xs text-muted-foreground truncate">{item.snippet}</div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
