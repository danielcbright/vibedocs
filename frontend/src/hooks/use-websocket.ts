import { useEffect, useRef, useState, useCallback } from "react"

interface UseWebSocketOptions {
  onReload?: (path: string) => void
  onRefreshTree?: () => void
}

export function useWebSocket({ onReload, onRefreshTree }: UseWebSocketOptions) {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const onReloadRef = useRef(onReload)
  const onRefreshTreeRef = useRef(onRefreshTree)

  // Keep refs current without triggering reconnects
  useEffect(() => { onReloadRef.current = onReload }, [onReload])
  useEffect(() => { onRefreshTreeRef.current = onRefreshTree }, [onRefreshTree])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const host = window.location.host
    const ws = new WebSocket(`${protocol}//${host}`)

    ws.onopen = () => setConnected(true)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === "reload") {
          onReloadRef.current?.(msg.path)
        } else if (msg.type === "refresh-tree") {
          onRefreshTreeRef.current?.()
        }
      } catch {
        // Ignore parse errors
      }
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
