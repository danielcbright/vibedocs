import { useCallback, useEffect, useState } from "react"
import type { RunMeta } from "@shared/agent-run-types"

/**
 * Rail data. Best-effort like the rest of the client: a failure yields an empty
 * list rather than an error state, because an empty rail and an unreachable
 * server look the same to the operator and neither should break the docs view.
 */
export function useRuns(enabled: boolean) {
  const [runs, setRuns] = useState<RunMeta[]>([])
  const [loading, setLoading] = useState(enabled)

  const refresh = useCallback(() => {
    if (!enabled) {
      setRuns([])
      setLoading(false)
      return
    }
    fetch("/api/runs")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body) => setRuns(Array.isArray(body?.data) ? body.data : []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false))
  }, [enabled])

  useEffect(() => { refresh() }, [refresh])
  return { runs, loading, refresh }
}
