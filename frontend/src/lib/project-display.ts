import type { Project } from "@/hooks/use-projects"

/**
 * What to call a project on screen.
 *
 * A project's identity is its folder name — that is what routes, what the API
 * takes, and what hash links contain. But a folder name is a filesystem
 * artifact, not a title, so a project shipping `.vibedocs.config.ts` can set a
 * `name` and have it used here. The routing key never changes, so existing
 * links keep working when someone adds or edits a display name.
 */
export function projectDisplayName(project: Pick<Project, "name" | "siteConfig">): string {
  const configured = project.siteConfig?.name?.trim()
  return configured && configured.length > 0 ? configured : project.name
}
