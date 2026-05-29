import { useEffect, useRef, useState, useCallback } from "react"
import { apiClient, type ApiClient } from "@/lib/api-client"

/**
 * Pre-fetches the raw markdown for a document so callers can read it
 * synchronously inside a user-gesture handler (e.g. Clipboard API on
 * Copy-button click). Returns the latest content as a ref plus loading /
 * error state, and a `refresh` callback that re-fetches on demand.
 *
 * Why a ref for `content`?
 * - The Clipboard API requires the write to happen synchronously inside a
 *   user gesture. We can't `await` a fetch inside the click handler, so we
 *   pre-fetch on mount + on path/reload changes and stash the result in a
 *   ref the handler reads immediately.
 *
 * The hook re-fetches when `project` or `docPath` changes, and when the
 * optional `reloadNonce` changes — pass a counter that callers bump on
 * WebSocket `reload` events to keep the cached content fresh.
 */
export function useRawDocument(
  project: string | null,
  docPath: string | null,
  reloadNonce?: number,
  client: ApiClient = apiClient,
) {
  const contentRef = useRef<string>("")
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  })

  // Track the latest in-flight request so callers (and the effect) can
  // cancel a stale fetch when inputs change. A monotonic id avoids races
  // where an old fetch resolves after a newer one.
  const requestIdRef = useRef(0)

  const fetchRaw = useCallback(() => {
    contentRef.current = ""
    const requestId = ++requestIdRef.current

    if (!project || !docPath) {
      setState({ loading: false, error: null })
      return
    }

    setState({ loading: true, error: null })

    client
      .getRawDoc(project, docPath)
      .then((text) => {
        if (requestId !== requestIdRef.current) return
        contentRef.current = text
        setState({ loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return
        contentRef.current = ""
        const message = err instanceof Error ? err.message : "Failed to load raw markdown"
        setState({ loading: false, error: message })
      })
  }, [project, docPath, client])

  // `reloadNonce` is listed so live-reload events trigger a re-fetch
  // without callers needing to invoke `refresh` themselves.
  useEffect(() => {
    fetchRaw()
  }, [fetchRaw, reloadNonce])

  return {
    /** Mutable ref holding the latest raw content. Read inside sync handlers. */
    contentRef,
    /** True while a fetch is in flight. */
    loading: state.loading,
    /** Error message from the most recent fetch, or null. */
    error: state.error,
    /** Force a re-fetch. */
    refresh: fetchRaw,
  }
}
