import type { FsEvent, FsEventListener, FsEventSource } from '../ports/fs-event-source.js'

/**
 * Test adapter — synchronous, deterministic FsEventSource.
 *
 * AppState tests drive `emit()` directly and assert on observable side-effects
 * (broadcast queue, search-index version, site-config cache state). No timers,
 * no real filesystem, no chokidar.
 */

export interface InMemoryFsEventSource extends FsEventSource {
  /** Synchronously deliver `event` to every subscriber, in subscription order. */
  emit(event: FsEvent): void
}

export function createInMemoryFsEventSource(): InMemoryFsEventSource {
  const listeners: FsEventListener[] = []
  let closed = false

  return {
    subscribe(listener) {
      listeners.push(listener)
    },
    emit(event) {
      if (closed) return
      for (const l of listeners) l(event)
    },
    async close() {
      closed = true
    },
  }
}
