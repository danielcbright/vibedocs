/**
 * Port: file-system event source.
 *
 * Production wraps chokidar. Tests use a synchronous in-memory implementation
 * that lets us assert on AppState's reaction to file-system change without
 * spinning up a real watcher. See ADR-0001.
 *
 * The five event kinds mirror chokidar's surface; AppState's subscriber
 * decides what to do (search-index rebuild, broadcast, site-config invalidate).
 */

export type FsEventKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface FsEvent {
  kind: FsEventKind
  /** Absolute filesystem path. */
  path: string
}

export type FsEventListener = (event: FsEvent) => void

export interface FsEventSource {
  /** Register a listener. Listeners are called in subscription order. */
  subscribe(listener: FsEventListener): void
  /** Stop emitting; release any underlying resources. Idempotent. */
  close(): Promise<void>
}
