import { useEffect, useRef, useState, useCallback } from "react"
import { parseWsMessage, type WsMessage } from "@shared/ws-messages"
import { devWsTarget, resolveWsUrl } from "@/lib/ws-url"

interface UseWebSocketOptions {
  onReload?: (path: string) => void
  onRefreshTree?: () => void
  onRunUpdated?: (runId: string) => void
  onRunRecords?: (runId: string, recCount: number) => void
  onRunDeleted?: (runId: string) => void
}

type WsCallbacks = UseWebSocketOptions

/**
 * Pure dispatch for a parsed WebSocket message. Routes each variant to its
 * callback. Extracted from the hook so the message-type switch can be tested
 * without standing up a socket. Exhaustive over `WsMessage` — adding a variant
 * forces a compile error here until it is handled.
 */
export function handleWsMessage(msg: WsMessage, callbacks: WsCallbacks): void {
  switch (msg.type) {
    case "reload":
      callbacks.onReload?.(msg.path)
      break
    case "refresh-tree":
      callbacks.onRefreshTree?.()
      break
    case "run-updated":
      callbacks.onRunUpdated?.(msg.runId)
      break
    case "run-records":
      callbacks.onRunRecords?.(msg.runId, msg.recCount)
      break
    case "run-deleted":
      callbacks.onRunDeleted?.(msg.runId)
      break
    default: {
      const _exhaustive: never = msg
      void _exhaustive
    }
  }
}

export function useWebSocket({ onReload, onRefreshTree, onRunUpdated, onRunRecords, onRunDeleted }: UseWebSocketOptions) {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onReloadRef = useRef(onReload)
  const onRefreshTreeRef = useRef(onRefreshTree)
  const onRunUpdatedRef = useRef(onRunUpdated)
  const onRunRecordsRef = useRef(onRunRecords)
  const onRunDeletedRef = useRef(onRunDeleted)

  // Keep refs current without triggering reconnects
  useEffect(() => { onReloadRef.current = onReload }, [onReload])
  useEffect(() => { onRefreshTreeRef.current = onRefreshTree }, [onRefreshTree])
  useEffect(() => { onRunUpdatedRef.current = onRunUpdated }, [onRunUpdated])
  useEffect(() => { onRunRecordsRef.current = onRunRecords }, [onRunRecords])
  useEffect(() => { onRunDeletedRef.current = onRunDeleted }, [onRunDeleted])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // Not `window.location` directly: under `npm run dev` that is Vite, where a
    // plain WebSocket hangs rather than failing. See resolveWsUrl (#195).
    const ws = new WebSocket(resolveWsUrl(window.location, devWsTarget()))

    ws.onopen = () => setConnected(true)

    ws.onmessage = (event) => {
      const msg: WsMessage | null = parseWsMessage(event.data)
      if (!msg) return

      // Read callbacks off the refs so a callback swap doesn't recreate the
      // socket — the refs stay current via the effects above.
      handleWsMessage(msg, {
        onReload: onReloadRef.current,
        onRefreshTree: onRefreshTreeRef.current,
        onRunUpdated: onRunUpdatedRef.current,
        onRunRecords: onRunRecordsRef.current,
        onRunDeleted: onRunDeletedRef.current,
      })
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws.close()
    }

    wsRef.current = ws
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { connected }
}
