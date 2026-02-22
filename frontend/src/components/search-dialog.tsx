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
}

export function SearchDialog({ onNavigate }: SearchDialogProps) {
  const [open, setOpen] = useState(false)
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
  }, [])

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
