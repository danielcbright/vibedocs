import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { ProjectInfo } from "@/hooks/use-projects"

/**
 * Curated nav renderer used when `project.siteConfig.nav` is present.
 *
 * Renders each section as a flat list of plain `<a>` links pointing at the
 * project's hash URL. Plain anchors (rather than JS click handlers) keep the
 * markup hydration-friendly for the eventual static-site build mode — the
 * static HTML is functional without React, and rehydration is a no-op swap.
 *
 * No expand/collapse, no filter input: curated nav is already short and
 * authored deliberately, so the file-tree affordances are out of scope.
 */
export function SiteNavSections({
  project,
  activePath,
  onNavigate,
}: {
  project: ProjectInfo
  activePath: string | null
  onNavigate: (project: string, path: string) => void
}) {
  const sections = project.siteConfig?.nav?.sections ?? []
  return (
    <>
      {sections.map((section, sectionIdx) => (
        <SidebarGroup key={`${section.label}-${sectionIdx}`} className="p-1 px-2">
          <SidebarGroupLabel
            data-testid="site-nav-section-label"
            className="h-7 text-xs font-medium text-muted-foreground"
          >
            {section.label}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0">
              {section.items.map((item) => {
                const label = item.split('/').pop() ?? item
                const isActive = activePath === item
                return (
                  <SidebarMenuItem key={item}>
                    <a
                      href={`#${project.name}/${item}`}
                      data-testid="site-nav-link"
                      data-active={isActive ? 'true' : undefined}
                      onClick={(e) => {
                        // Intercept so the SPA's hash-router handles navigation
                        // through the same path the file-tree mode uses.
                        // Plain `<a>` markup remains for the static-build mode.
                        e.preventDefault()
                        onNavigate(project.name, item)
                      }}
                      className="tap-row tap-active-feedback flex items-center gap-2 rounded-md px-2 text-xs h-7 transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium"
                    >
                      <span className="truncate">{label}</span>
                    </a>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}
