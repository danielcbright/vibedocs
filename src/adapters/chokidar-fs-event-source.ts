import chokidar from 'chokidar'
import type { FsEvent, FsEventListener, FsEventSource } from '../ports/fs-event-source.js'

/**
 * Production adapter — wraps chokidar.
 *
 * The five chokidar event names map 1:1 to our FsEventKind so the AppState
 * subscriber doesn't have to know about chokidar at all. node_modules and .git
 * are excluded at the watcher layer to keep the event volume sane on large
 * project trees.
 */

export interface ChokidarFsEventSourceOptions {
  /** Glob (or array of globs) chokidar watches. Typically `<PROJECTS_DIR>/**\/*`. */
  watchGlob: string | string[]
}

export function createChokidarFsEventSource(
  opts: ChokidarFsEventSourceOptions,
): FsEventSource {
  const listeners: FsEventListener[] = []
  const watcher = chokidar.watch(opts.watchGlob, {
    ignoreInitial: true,
    ignored: ['**/node_modules/**', '**/.git/**'],
  })

  function fanout(event: FsEvent): void {
    for (const l of listeners) l(event)
  }

  watcher
    .on('change', (p: string) => fanout({ kind: 'change', path: p }))
    .on('add', (p: string) => fanout({ kind: 'add', path: p }))
    .on('unlink', (p: string) => fanout({ kind: 'unlink', path: p }))
    .on('addDir', (p: string) => fanout({ kind: 'addDir', path: p }))
    .on('unlinkDir', (p: string) => fanout({ kind: 'unlinkDir', path: p }))

  return {
    subscribe(listener) {
      listeners.push(listener)
    },
    async close() {
      await watcher.close()
    },
  }
}
