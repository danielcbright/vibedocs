import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, render, act, waitFor, screen } from '@testing-library/react'
import { useWebSocket } from '@/hooks/use-websocket'
import { ConnectionStatus } from '@/components/connection-status'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Tests for `useWebSocket` — the live-reload hook.
 *
 * The hook constructs `new WebSocket(...)` against `window.location`. We
 * replace `globalThis.WebSocket` with a controllable mock so we can drive
 * the open → message → close → reconnect lifecycle deterministically.
 *
 * The reconnect timer (2000ms) is driven with vitest fake timers.
 */

// ── Mock WebSocket ────────────────────────────────────────────────────────────

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number = MockWebSocket.CONNECTING
  url: string
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  /** Every constructed instance is appended here so tests can drive lifecycle. */
  static instances: MockWebSocket[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  /** Test helper: simulate the server accepting the handshake. */
  openConnection() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  /** Test helper: simulate inbound payload from the server. */
  receive(payload: unknown) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  /** Test helper: simulate the socket closing for any reason. */
  closeFromServer() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  /** Standard WebSocket API — invoked by the hook on cleanup / error. */
  close() {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  /** Test helper: reset the instance log between tests. */
  static reset() {
    MockWebSocket.instances = []
  }
}

let originalWebSocket: typeof WebSocket

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket
  // The hook compares against `WebSocket.OPEN` from the global — our mock
  // exposes the same static constants, so the check works identically.
  ;(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
    MockWebSocket
  MockWebSocket.reset()
})

afterEach(() => {
  ;(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    originalWebSocket
  vi.useRealTimers()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useWebSocket — initial connection', () => {
  it('constructs a WebSocket on mount and reflects connected=true after onopen', async () => {
    const { result } = renderHook(() => useWebSocket({}))

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(result.current.connected).toBe(false)

    act(() => {
      MockWebSocket.instances[0].openConnection()
    })

    await waitFor(() => expect(result.current.connected).toBe(true))
  })

  it('targets the current host with ws:// when page protocol is http', () => {
    renderHook(() => useWebSocket({}))
    expect(MockWebSocket.instances).toHaveLength(1)
    // jsdom default location is http://localhost/
    expect(MockWebSocket.instances[0].url.startsWith('ws://')).toBe(true)
  })
})

describe('useWebSocket — message dispatch', () => {
  it('invokes onReload with the path when a {type:"reload"} message arrives', () => {
    const onReload = vi.fn()
    renderHook(() => useWebSocket({ onReload }))

    act(() => {
      MockWebSocket.instances[0].openConnection()
      MockWebSocket.instances[0].receive({
        type: 'reload',
        path: 'docs/example.md',
      })
    })

    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onReload).toHaveBeenCalledWith('docs/example.md')
  })

  it('invokes onRefreshTree (no args) when a {type:"refresh-tree"} message arrives', () => {
    const onRefreshTree = vi.fn()
    renderHook(() => useWebSocket({ onRefreshTree }))

    act(() => {
      MockWebSocket.instances[0].openConnection()
      MockWebSocket.instances[0].receive({ type: 'refresh-tree' })
    })

    expect(onRefreshTree).toHaveBeenCalledTimes(1)
    expect(onRefreshTree).toHaveBeenCalledWith()
  })

  it('ignores malformed payloads without throwing', () => {
    const onReload = vi.fn()
    const onRefreshTree = vi.fn()
    renderHook(() => useWebSocket({ onReload, onRefreshTree }))

    act(() => {
      MockWebSocket.instances[0].openConnection()
      MockWebSocket.instances[0].receive('not json')
      MockWebSocket.instances[0].receive({ type: 'unknown' })
      MockWebSocket.instances[0].receive({ type: 'reload' /* missing path */ })
    })

    expect(onReload).not.toHaveBeenCalled()
    expect(onRefreshTree).not.toHaveBeenCalled()
  })
})

describe('useWebSocket — disconnect detection', () => {
  it('flips connected back to false when the socket closes', async () => {
    const { result } = renderHook(() => useWebSocket({}))

    act(() => {
      MockWebSocket.instances[0].openConnection()
    })
    await waitFor(() => expect(result.current.connected).toBe(true))

    act(() => {
      MockWebSocket.instances[0].closeFromServer()
    })

    await waitFor(() => expect(result.current.connected).toBe(false))
  })
})

describe('useWebSocket — reconnection', () => {
  it('constructs a new WebSocket after the reconnect delay elapses', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWebSocket({}))

    act(() => {
      MockWebSocket.instances[0].openConnection()
    })
    expect(MockWebSocket.instances).toHaveLength(1)

    // Close — schedules reconnect in 2000ms.
    act(() => {
      MockWebSocket.instances[0].closeFromServer()
    })
    expect(MockWebSocket.instances).toHaveLength(1)

    // Below threshold — still no new socket.
    await act(async () => {
      vi.advanceTimersByTime(1999)
    })
    expect(MockWebSocket.instances).toHaveLength(1)

    // Cross the threshold — new socket constructed.
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(MockWebSocket.instances).toHaveLength(2)

    // Switch back to real timers so React's scheduling + waitFor work.
    vi.useRealTimers()
    // And the new socket can complete its handshake.
    act(() => {
      MockWebSocket.instances[1].openConnection()
    })
    await waitFor(() => expect(result.current.connected).toBe(true))
  })

  it('delivers messages on the reconnected socket identically to the first connection', async () => {
    vi.useFakeTimers()
    const onReload = vi.fn()
    const onRefreshTree = vi.fn()
    renderHook(() => useWebSocket({ onReload, onRefreshTree }))

    // First connection — message arrives.
    act(() => {
      MockWebSocket.instances[0].openConnection()
      MockWebSocket.instances[0].receive({ type: 'reload', path: 'a.md' })
    })
    expect(onReload).toHaveBeenCalledTimes(1)

    // Close, advance past reconnect delay, second socket spawns.
    act(() => {
      MockWebSocket.instances[0].closeFromServer()
    })
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(MockWebSocket.instances).toHaveLength(2)

    // Second connection delivers messages to the SAME callbacks.
    act(() => {
      MockWebSocket.instances[1].openConnection()
      MockWebSocket.instances[1].receive({ type: 'reload', path: 'b.md' })
      MockWebSocket.instances[1].receive({ type: 'refresh-tree' })
    })

    expect(onReload).toHaveBeenCalledTimes(2)
    expect(onReload).toHaveBeenLastCalledWith('b.md')
    expect(onRefreshTree).toHaveBeenCalledTimes(1)
  })

  it('still reconnects after onerror triggers ws.close()', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWebSocket({}))

    act(() => {
      MockWebSocket.instances[0].openConnection()
    })

    // Simulate transport error — the hook calls ws.close() in onerror,
    // which triggers onclose, which schedules the reconnect.
    act(() => {
      MockWebSocket.instances[0].onerror?.(new Event('error'))
    })

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(MockWebSocket.instances).toHaveLength(2)

    vi.useRealTimers()
    act(() => {
      MockWebSocket.instances[1].openConnection()
    })
    await waitFor(() => expect(result.current.connected).toBe(true))
  })

  it('drives ConnectionStatus through connect → disconnect → reconnect cycles', async () => {
    vi.useFakeTimers()
    function Harness() {
      const { connected } = useWebSocket({})
      return (
        <TooltipProvider>
          <ConnectionStatus connected={connected} />
        </TooltipProvider>
      )
    }

    render(<Harness />)
    const dot = () => screen.getByRole('status')

    // Initially: disconnected.
    expect(dot()).toHaveAttribute('aria-label', 'Disconnected')

    // First handshake completes — `act` flushes the resulting state update.
    act(() => {
      MockWebSocket.instances[0].openConnection()
    })
    expect(dot()).toHaveAttribute('aria-label', 'Live reload connected')

    // Server drops us — status returns to disconnected.
    act(() => {
      MockWebSocket.instances[0].closeFromServer()
    })
    expect(dot()).toHaveAttribute('aria-label', 'Disconnected')

    // Reconnect cycle: new socket constructed after the delay.
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(MockWebSocket.instances).toHaveLength(2)

    // Second handshake completes — status flips back to connected.
    act(() => {
      MockWebSocket.instances[1].openConnection()
    })
    expect(dot()).toHaveAttribute('aria-label', 'Live reload connected')
  })

  it('cancels any pending reconnect when the hook unmounts', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useWebSocket({}))

    act(() => {
      MockWebSocket.instances[0].openConnection()
      MockWebSocket.instances[0].closeFromServer()
    })
    expect(MockWebSocket.instances).toHaveLength(1)

    unmount()

    // The pending reconnect timer must NOT fire — no new socket.
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(MockWebSocket.instances).toHaveLength(1)
  })
})
