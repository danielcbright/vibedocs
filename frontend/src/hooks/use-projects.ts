import { useState, useEffect, useCallback } from "react"
import type { SiteConfig } from "@shared/site-config-types"
import { apiClient, type ApiClient } from "@/lib/api-client"

export interface FileNode {
  name: string
  path: string
  type: "file" | "folder"
  children?: FileNode[]
  isAsset?: boolean
}

export interface ProjectInfo {
  name: string
  hasDocsFolder: boolean
  tree: FileNode[]
  /** Per-project site config (loaded from `.vibedocs.config.ts`). `null` when
   *  the project ships no config file; `undefined` only on the wire while a
   *  pre-config server is in flight. */
  siteConfig?: SiteConfig | null
  /** Set on a hidden project fetched on its own (ADR-0003); never in `/api/projects`. */
  hidden?: boolean
}

export type FileTypeFilter = "all" | "markdown" | "assets"

export function useProjects(
  fileType: FileTypeFilter = "all",
  client: ApiClient = apiClient,
) {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await client.getProjects(fileType)
      setProjects(data)
    } catch (err) {
      console.error("Failed to fetch projects:", err)
    } finally {
      setLoading(false)
    }
  }, [fileType, client])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { projects, loading, refresh }
}

/**
 * The active project when it is hidden (ADR-0003). `/api/projects` leaves hidden
 * projects out, but a doc in one can still be opened by path, and the sidebar then
 * needs that project's tree to show where you are. Null whenever the active
 * project is listed — including while the list is still loading, so a listed
 * project is never fetched twice.
 */
export function useHiddenProject(
  activeProject: string | null,
  projects: ProjectInfo[],
  loading: boolean,
  fileType: FileTypeFilter = "all",
  client: ApiClient = apiClient,
): ProjectInfo | null {
  const [hidden, setHidden] = useState<ProjectInfo | null>(null)
  const unlisted = !loading && !!activeProject && !projects.some((p) => p.name === activeProject)

  useEffect(() => {
    if (!unlisted || !activeProject) {
      setHidden(null)
      return
    }
    let cancelled = false
    client
      .getProjectTree(activeProject, fileType)
      .then((p) => !cancelled && setHidden(p.hidden ? p : null))
      .catch(() => !cancelled && setHidden(null))
    return () => {
      cancelled = true
    }
  }, [unlisted, activeProject, fileType, client])

  return hidden
}
