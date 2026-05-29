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
