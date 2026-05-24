import { useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { List } from "lucide-react"
import { cn } from "@/lib/utils"

interface TocEntry {
  level: number
  id: string
  text: string
}

interface MobileTocProps {
  toc: TocEntry[]
}

function decodeHtmlEntities(str: string): string {
  const textarea = document.createElement("textarea")
  textarea.innerHTML = str
  return textarea.value
}

/**
 * Floating "On this page" FAB + bottom-sheet TOC for mobile.
 *
 * Rendered alongside (not inside) the doc content so the FAB stays
 * pinned to the viewport regardless of the doc's scroll position.
 * Tapping the FAB opens a bottom Sheet listing the document headings;
 * tapping a heading scrolls to it and closes the sheet.
 *
 * Returns null when the doc has fewer than 2 headings (consistent
 * with the desktop `hasToc` rule in App.tsx) to avoid visual noise
 * on short pages.
 */
export function MobileToc({ toc }: MobileTocProps) {
  const [open, setOpen] = useState(false)

  if (toc.length < 2) return null

  const handleNavigate = (id: string) => {
    setOpen(false)
    // Defer scroll until after the sheet starts closing so the smooth
    // scroll target is the prose container, not the sheet's animation.
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg"
        aria-label="On this page"
        data-testid="mobile-toc-trigger"
        onClick={() => setOpen(true)}
      >
        <List className="h-5 w-5" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[70dvh] p-0 flex flex-col"
          data-testid="mobile-toc-sheet"
        >
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <List className="h-4 w-4" />
              On this page
            </SheetTitle>
            <SheetDescription className="sr-only">
              Document headings. Tap one to jump to that section.
            </SheetDescription>
          </SheetHeader>
          <nav className="flex-1 overflow-y-auto py-2 px-4">
            <ul className="space-y-1">
              {toc.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      handleNavigate(item.id)
                    }}
                    className={cn(
                      "flex items-center text-sm py-2 transition-colors hover:text-foreground tap-row tap-active-feedback rounded-md",
                      item.level === 2 && "pl-0",
                      item.level === 3 && "pl-3",
                      item.level >= 4 && "pl-6",
                      "text-muted-foreground",
                    )}
                  >
                    {decodeHtmlEntities(item.text)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
