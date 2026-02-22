import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { List } from "lucide-react"

interface TocEntry {
  level: number
  id: string
  text: string
}

interface TocPanelProps {
  toc: TocEntry[]
}

function decodeHtmlEntities(str: string): string {
  const textarea = document.createElement("textarea")
  textarea.innerHTML = str
  return textarea.value
}

export function TocPanel({ toc }: TocPanelProps) {
  const [activeId, setActiveId] = useState<string>("")

  // Scroll-spy with IntersectionObserver
  useEffect(() => {
    if (toc.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the first heading that's visible at the top
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
            break
          }
        }
      },
      {
        rootMargin: "-80px 0px -70% 0px",
        threshold: 0,
      }
    )

    // Observe all heading elements
    for (const item of toc) {
      const el = document.getElementById(item.id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [toc])

  return (
    <div className="h-full flex flex-col overflow-hidden border-l">
      <div className="px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <List className="h-3.5 w-3.5 shrink-0" />
          On this page
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <nav className="py-3 px-4">
          <ul className="space-y-1">
            {toc.map((item) => (
              <li key={item.id} className="overflow-hidden">
                <a
                  href={`#${item.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    const el = document.getElementById(item.id)
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth", block: "start" })
                      setActiveId(item.id)
                    }
                  }}
                  title={decodeHtmlEntities(item.text)}
                  className={cn(
                    "block text-xs py-1 transition-colors hover:text-foreground truncate",
                    item.level === 2 && "pl-0",
                    item.level === 3 && "pl-3",
                    activeId === item.id
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {decodeHtmlEntities(item.text)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  )
}
