import { Check, FolderTree } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { isStaticBuild } from "@/lib/is-static"
import type { ProjectInfo } from "@/hooks/use-projects"

interface ProjectSwitcherProps {
  projects: ProjectInfo[]
  activeProject: string | null
  /** Navigate to a project. Called with an empty path so `navigateSmart`
   *  resolves to that project's first markdown file. */
  onNavigate: (project: string, path: string) => void
}

/**
 * Corner "switch project" dropdown — live workspace only.
 *
 * Issue #58: a fixed top-right affordance that lets the operator jump between
 * projects without losing the site-preview-faithful chrome. It is mounted
 * OUTSIDE the `.vd-site-preview` scope (see App.tsx) so it always renders in
 * vibedocs theming even when the page body is showing a site preview, and it
 * is hidden in static builds (`window.__VIBEDOCS_STATIC === true`) where the
 * generated site is a single project with no app to switch within.
 */
export function ProjectSwitcher({
  projects,
  activeProject,
  onNavigate,
}: ProjectSwitcherProps) {
  if (isStaticBuild() || projects.length === 0) return null

  return (
    <div className="fixed right-3 top-3 z-50">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label="Switch project"
            className="tap-target tap-active-feedback h-11 gap-1.5 bg-background/90 shadow-sm backdrop-blur md:h-9"
          >
            <FolderTree className="h-4 w-4" />
            <span className="max-w-[10rem] truncate text-xs font-medium">
              {activeProject ?? "Switch project"}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Switch project</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {projects.map((project) => {
            const isActive = project.name === activeProject
            return (
              <DropdownMenuItem
                key={project.name}
                aria-current={isActive ? "true" : undefined}
                onSelect={() => onNavigate(project.name, "")}
                className="tap-row justify-between gap-2"
              >
                <span className="truncate">{project.name}</span>
                {isActive ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                ) : null}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
