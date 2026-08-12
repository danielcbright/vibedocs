import { useCallback, useEffect, useRef, useState } from "react"
import { applyRecords, type AgentEvent, type RunMeta } from "@shared/agent-run-types"

/**
 * Event data for one run.
 *
 * Pages by RECORD position, not event seq: a patch can target an event from an
 * earlier page, so seq-based paging would miss completions. The fold is
 * incremental, which makes a live nudge and a reconnect catch-up the same call.
 */
export function useRunRecords(runId: string | null) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [meta, setMeta] = useState<RunMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Records consumed so far — the paging cursor, in a ref so fetchTail is stable. */
  const recCount = useRef(0)

  const fetchTail = useCallback(async () => {
    if (!runId) return
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/events?fromRec=${recCount.current}`)
      if (!res.ok) throw new Error(`events ${res.status}`)
      const body = await res.json()
      const records = body?.data?.records
      if (!Array.isArray(records) || records.length === 0) return
      recCount.current = body.data.recCount
      setEvents((prev) => applyRecords(prev, records))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load events")
    }
  }, [runId])

  const refreshMeta = useCallback(async () => {
    if (!runId) return
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`)
      setMeta(res.ok ? (await res.json()).data : null)
    } catch {
      setMeta(null)
    }
  }, [runId])

  // Reset on run change — stale events must never fold into a different run.
  useEffect(() => {
    recCount.current = 0
    setEvents([])
    setMeta(null)
    setError(null)
    if (!runId) return
    setLoading(true)
    void Promise.all([refreshMeta(), fetchTail()]).finally(() => setLoading(false))
  }, [runId, refreshMeta, fetchTail])

  return { events, meta, loading, error, fetchTail, refreshMeta }
}
