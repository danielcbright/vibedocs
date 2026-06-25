import { Check, ChevronsUpDown, FolderTree } from "lucide-react"
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
  /**
   * When true, render in-flow so a parent can place it (e.g. inside the content
   * header, where it replaces the old static project-name label). When false
   * (default) it renders as the fixed top-right corner affordance used in the
   * mobile layout.
   */
  inline?: boolean
}

/**
 * "Switch project" dropdown — live workspace only.
 *
 * Issue #58 introduced this as a fixed top-right affordance. On desktop it now
 * lives `inline` inside the content header, replacing the redundant static
 * project-name label (one project indicator, and it's interactive). The mobile
 * layout keeps the fixed-corner placement. Hidden in static builds
 * (`window.__VIBEDOCS_STATIC === true`) where the generated site is a single
 * project with nothing to switch between.
 */
export function ProjectSwitcher({
  projects,
  activeProject,
  onNavigate,
  inline = false,
}: ProjectSwitcherProps) {
  if (isStaticBuild() || projects.length === 0) return null

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={inline ? "ghost" : "outline"}
          size="sm"
          aria-label="Switch project"
          className={
            inline
              ? "tap-target tap-active-feedback -ml-2 h-9 gap-1.5"
              : "tap-target tap-active-feedback h-11 gap-1.5 bg-background/90 shadow-sm backdrop-blur md:h-9"
          }
        >
          <FolderTree className="h-4 w-4" />
          <span className="max-w-[12rem] truncate text-sm font-medium">
            {activeProject ?? "Switch project"}
          </span>
          {inline ? (
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={inline ? "start" : "end"} className="w-56">
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
  )

  if (inline) return menu
  return <div className="fixed right-3 top-3 z-50">{menu}</div>
}
