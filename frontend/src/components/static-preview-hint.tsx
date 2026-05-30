import { Globe } from "lucide-react"
import { Button } from "@/components/ui/button"

interface StaticPreviewHintProps {
  project: string | null
}

export function StaticPreviewHint({ project }: StaticPreviewHintProps) {
  if (!project) return null
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 tap-target tap-active-feedback"
      aria-label="Preview as static site"
      title="Preview as static site"
    >
      <Globe className="h-3.5 w-3.5" />
    </Button>
  )
}
