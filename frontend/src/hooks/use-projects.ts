import { useState, useEffect, useCallback } from "react"

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
}

export type FileTypeFilter = "all" | "markdown" | "assets"

export function useProjects(fileType: FileTypeFilter = "all") {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects?fileType=${fileType}`)
      const json = await res.json()
      setProjects(json.data || [])
    } catch (err) {
      console.error("Failed to fetch projects:", err)
    } finally {
      setLoading(false)
    }
  }, [fileType])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { projects, loading, refresh }
}
