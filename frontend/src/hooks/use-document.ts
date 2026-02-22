import { useState, useEffect, useCallback } from "react"

interface TocEntry {
  level: number
  id: string
  text: string
}

interface DocumentState {
  html: string
  toc: TocEntry[]
  loading: boolean
  error: string | null
}

export function useDocument(project: string | null, docPath: string | null) {
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
      const res = await fetch(`/api/render/${encodeURIComponent(project)}/${docPath}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to load" }))
        setState({ html: "", toc: [], loading: false, error: err.error || "Failed to load" })
        return
      }
      const json = await res.json()
      setState({
        html: json.data?.html || "",
        toc: json.data?.toc || [],
        loading: false,
        error: null,
      })
    } catch (err) {
      console.error("Failed to fetch document:", err)
      setState({ html: "", toc: [], loading: false, error: "Network error" })
    }
  }, [project, docPath])

  useEffect(() => {
    fetchDoc()
  }, [fetchDoc])

  return { ...state, refresh: fetchDoc }
}
