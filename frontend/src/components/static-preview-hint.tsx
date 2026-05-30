import { Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover"

interface StaticPreviewHintProps {
  project: string | null
}

const PREVIEW_PORT = 9001

function buildCommand(project: string): string {
  return `npx vibedocs build --project ${project} --serve --port ${PREVIEW_PORT}`
}

export function StaticPreviewHint({ project }: StaticPreviewHintProps) {
  if (!project) return null

  const command = buildCommand(project)
  const previewUrl = `http://localhost:${PREVIEW_PORT}`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 tap-target tap-active-feedback"
          aria-label="Preview as static site"
          title="Preview as static site"
        >
          <Globe className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <PopoverHeader>
          <PopoverTitle>Preview as static site</PopoverTitle>
          <PopoverDescription>
            See what <span className="font-medium text-foreground">{project}</span>{" "}
            looks like as a published documentation site — clean URLs, no SPA,
            exactly what ships to a static host.
          </PopoverDescription>
        </PopoverHeader>
        <pre className="mt-3 overflow-x-auto rounded-md border bg-muted px-3 py-2 text-xs font-mono">
          <code>{command}</code>
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">
          Then open {previewUrl}
        </p>
      </PopoverContent>
    </Popover>
  )
}
