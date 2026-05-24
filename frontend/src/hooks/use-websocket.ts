import { useEffect, useRef, useState, useCallback } from "react"
import { parseWsMessage, type WsMessage } from "@shared/ws-messages"

interface UseWebSocketOptions {
  onReload?: (path: string) => void
  onRefreshTree?: () => void
}

export function useWebSocket({ onReload, onRefreshTree }: UseWebSocketOptions) {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
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
      const msg: WsMessage | null = parseWsMessage(event.data)
      if (!msg) return

      switch (msg.type) {
        case "reload":
          onReloadRef.current?.(msg.path)
          break
        case "refresh-tree":
          onRefreshTreeRef.current?.()
          break
        default: {
          // Exhaustiveness check: adding a new variant to WsMessage forces
          // a compile error here until it is handled above.
          const _exhaustive: never = msg
          void _exhaustive
        }
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
