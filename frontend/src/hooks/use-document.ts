import { useState, useEffect, useCallback } from "react"
import { apiClient, ApiError, type ApiClient, type TocEntry } from "@/lib/api-client"

interface DocumentState {
  html: string
  toc: TocEntry[]
  loading: boolean
  error: string | null
}

export function useDocument(
  project: string | null,
  docPath: string | null,
  client: ApiClient = apiClient,
) {
  const [state, setState] = useState<DocumentState>({
    html: "",
    toc: [],
    loading: false,
    error: null,
  })

  const fetchDoc = useCallback(async () => {
    if (!project || !docPath) {
      setState({ html: "", toc: [], loading: false, error: null })
      return
    }

    setState((prev) => ({ ...prev, loading: true, error: null }))

    try {
      const doc = await client.renderDoc(project, docPath)
      setState({ html: doc.html, toc: doc.toc, loading: false, error: null })
    } catch (err) {
      console.error("Failed to fetch document:", err)
      const message = err instanceof ApiError ? err.message : "Network error"
      setState({ html: "", toc: [], loading: false, error: message })
    }
  }, [project, docPath, client])

  useEffect(() => {
    fetchDoc()
  }, [fetchDoc])

  return { ...state, refresh: fetchDoc }
}
