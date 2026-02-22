import { useState, useEffect, useRef } from "react"

export interface SearchResult {
  project: string
  path: string
  filename: string
  snippet: string
}

export function useSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController>()

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)

    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (!controller.signal.aborted) {
          setResults(json.data || [])
          setLoading(false)
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Search failed:", err)
          setLoading(false)
        }
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [query])

  return { results, loading }
}
