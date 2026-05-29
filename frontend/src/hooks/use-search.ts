import { useState, useEffect, useRef } from "react"
import { apiClient, type ApiClient, type SearchResult } from "@/lib/api-client"

export type { SearchResult }

export function useSearch(query: string, client: ApiClient = apiClient) {
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
        const data = await client.search(trimmed, { signal: controller.signal })
        if (!controller.signal.aborted) {
          setResults(data)
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
  }, [query, client])

  return { results, loading }
}
