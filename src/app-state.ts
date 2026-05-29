/**
 * AppState — live-mode runtime state and orchestration.
 *
 * Owns: per-project siteConfig cache, full-text search index, file-system event
 * subscription, broadcast fan-out, upload-auth config snapshot.
 *
 * Explicitly does NOT own: path resolvers (stateless allocations stay
 * module-level in server.ts), HTTP route declarations, HTTP boot, or the
 * build-mode renderer. The two render modes — live and static — share no
 * orchestration code. See ADR-0001 (docs/adr/0001-appstate-shape.md).
 *
 * The public interface is behavioural-verb shaped (`listProjects`,
 * `renderPage`, `search`, `broadcast`, `uploadAuth`). The file-system
 * subscriber list — cache invalidation, search rebuild, broadcast — is an
 * implementation detail, not on the interface.
 *
 * Two ports are wired here at composition time: `FsEventSource` (Chokidar
 * production, in-memory test) and `ClientChannel` (`ws` production, in-memory
 * test). Search/site-config/projects/renderer are NOT ports — they are
 * already factory-shaped and tests pass stubs directly.
 */

import path from 'path'
import { readFile } from 'fs/promises'
import {
  discoverProjects,
  filterProjects,
  toProjectRelativePath,
  type ProjectInfo,
} from './discovery.js'
import { createIndexStore, type IndexStore, type SearchResult } from './search.js'
import { createSiteConfigCache, type SiteConfigCache } from './site-config-cache.js'
import { loadSiteConfig } from './site-config.js'
import type { SafePath } from './path-resolver.js'
import { renderSinglePage, type HtmlPage } from './render.js'
import { VibedocsError } from './errors.js'
import {
  reloadMessage,
  refreshTreeMessage,
  type WsMessage,
} from './shared/ws-messages.js'
import { isMarkdownPath } from './markdown-paths.js'
import type { UploadAuthConfig } from './upload-auth.js'
import type { FsEvent, FsEventSource } from './ports/fs-event-source.js'
import type { ClientChannel } from './ports/client-channel.js'

const CONFIG_FILENAME = '.vibedocs.config.ts'

export interface CreateAppStateOptions {
  /** Absolute directory that holds every project as a subfolder. */
  projectsDir: string
  /** Source of file-system events. Production wraps chokidar; tests use in-memory. */
  fsEventSource: FsEventSource
  /** Fan-out sink for WS messages. Production wraps `ws`; tests use in-memory. */
  clientChannel: ClientChannel
  /** Upload-route policy snapshot — read by registerUploadRoute / registerConfigRoute. */
  uploadAuth: UploadAuthConfig
  /** Optional: inject a pre-built search index store (testability). */
  searchStore?: IndexStore
  /** Optional: inject a pre-built site-config cache (testability). */
  siteConfigCache?: SiteConfigCache
}

export interface AppState {
  /** Discover projects + attach per-project siteConfig. */
  listProjects(fileType?: 'all' | 'markdown' | 'assets'): Promise<ProjectInfo[]>
  /** Render one markdown page in live mode. `safePath` must come from a PathResolver. */
  renderPage(safePath: SafePath, project: string, docPath: string): Promise<HtmlPage>
  /** Run a full-text search query against the in-memory index. */
  search(query: string, maxResults?: number): SearchResult[]
  /** Current search-index version (bumped on each successful rebuild). */
  readonly searchVersion: number
  /** Broadcast a typed WS message to every connected client. */
  broadcast(message: WsMessage): void
  /** Upload-route policy. Routes read this to know which gate to apply. */
  readonly uploadAuth: Readonly<UploadAuthConfig>
  /** Boot the watcher subscriber and finish the initial search-index build. */
  start(): Promise<void>
  /** Stop the watcher and the broadcast channel. Idempotent. */
  shutdown(): Promise<void>
  /** Test/diagnostics: whether the site-config cache currently memoises this project. */
  siteConfigCacheHas(projectName: string): boolean
}

export function createAppState(opts: CreateAppStateOptions): AppState {
  const { projectsDir, fsEventSource, clientChannel, uploadAuth } = opts

  const searchStore =
    opts.searchStore ?? createIndexStore({ projectsDir })

  const siteConfigCache =
    opts.siteConfigCache ??
    createSiteConfigCache({ loadConfig: loadSiteConfig, projectsDir })

  function isSiteConfig(filePath: string): boolean {
    return path.basename(filePath) === CONFIG_FILENAME
  }

  function rebuildSearchIndex(): void {
    searchStore.rebuild().then((v) => {
      console.log(`  🔍 Search index v${v}: rebuilt`)
    }).catch((err) => {
      console.error('Search rebuild failed:', err)
    })
  }

  function handleFsEvent(ev: FsEvent): void {
    const rel = toProjectRelativePath(ev.path, projectsDir)
    switch (ev.kind) {
      case 'change': {
        console.log(`  ↺  changed: ${rel ?? ev.path}`)
        if (isSiteConfig(ev.path)) siteConfigCache.invalidateFromPath(ev.path)
        if (isMarkdownPath(ev.path)) {
          // Only broadcast project-relative paths. Absolute paths would leak
          // the host filesystem layout to every connected client.
          if (rel !== null) clientChannel.broadcast(reloadMessage(rel))
          rebuildSearchIndex()
        } else {
          clientChannel.broadcast(refreshTreeMessage())
        }
        return
      }
      case 'add': {
        console.log(`  +  added:   ${rel ?? ev.path}`)
        if (isSiteConfig(ev.path)) siteConfigCache.invalidateFromPath(ev.path)
        clientChannel.broadcast(refreshTreeMessage())
        if (isMarkdownPath(ev.path)) rebuildSearchIndex()
        return
      }
      case 'unlink': {
        console.log(`  -  removed: ${rel ?? ev.path}`)
        if (isSiteConfig(ev.path)) siteConfigCache.invalidateFromPath(ev.path)
        clientChannel.broadcast(refreshTreeMessage())
        if (isMarkdownPath(ev.path)) rebuildSearchIndex()
        return
      }
      case 'addDir': {
        console.log(`  +  dir:     ${rel ?? ev.path}`)
        clientChannel.broadcast(refreshTreeMessage())
        return
      }
      case 'unlinkDir': {
        console.log(`  -  dir:     ${rel ?? ev.path}`)
        clientChannel.broadcast(refreshTreeMessage())
        return
      }
    }
  }

  fsEventSource.subscribe(handleFsEvent)

  return {
    async listProjects(fileType: 'all' | 'markdown' | 'assets' = 'all') {
      const projects = await discoverProjects(projectsDir)
      const filtered = filterProjects(projects, fileType)
      return Promise.all(
        filtered.map(async (p) => ({
          ...p,
          siteConfig: await siteConfigCache.get(p.name),
        })),
      )
    },

    async renderPage(safePath, project, docPath) {
      try {
        return await renderSinglePage(safePath, project, docPath, 'live')
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          throw new VibedocsError('not-found', 'File not found', { cause: err })
        }
        throw new VibedocsError('io', 'Failed to render document', { cause: err })
      }
    },

    search(query, maxResults) {
      return searchStore.search(query, maxResults)
    },

    get searchVersion() {
      return searchStore.version
    },

    broadcast(message) {
      clientChannel.broadcast(message)
    },

    uploadAuth,

    async start() {
      // Block on the initial search-index build so callers (and tests) can
      // assume `searchVersion >= 1` after `start()` resolves.
      await searchStore.rebuild()
    },

    async shutdown() {
      await fsEventSource.close()
      await clientChannel.close()
    },

    siteConfigCacheHas(projectName) {
      return siteConfigCache.has(projectName)
    },
  }
}

// ── Live boot one-liner ──────────────────────────────────────────────────────

import { parseUploadAuthConfig } from './upload-auth.js'
import { createChokidarFsEventSource } from './adapters/chokidar-fs-event-source.js'
import { createInMemoryClientChannel } from './adapters/in-memory-client-channel.js'
import { PROJECTS_DIR } from './discovery.js'

export interface LiveAppState extends AppState {
  /** Projects-directory absolute path (snapshot of env at boot). */
  readonly projectsDir: string
  /**
   * Swap the broadcast sink — used by server.ts after the HTTP server boots
   * to wire the real ws ClientChannel in. Pre-swap broadcasts go to the
   * placeholder in-memory channel so events that fire during boot are not lost.
   */
  setClientChannel(channel: ClientChannel): void
}

/**
 * Production boot: parse env, build the chokidar FsEventSource, build a
 * placeholder in-memory ClientChannel (server.ts swaps in the ws channel
 * once the HTTP server is ready), build AppState, kick off start().
 *
 * server.ts calls this, then constructs the HTTP server, then calls
 * `setClientChannel(createWsClientChannel(...))` to wire the real fan-out.
 * This split keeps server.ts a small composition root without leaking
 * chokidar or ws imports into it.
 */
export async function runLive(env: NodeJS.ProcessEnv = process.env): Promise<LiveAppState> {
  const projectsDir = PROJECTS_DIR
  const fsEventSource = createChokidarFsEventSource({
    watchGlob: `${projectsDir}/**/*`,
  })
  let clientChannel: ClientChannel = createInMemoryClientChannel()

  const inner = createAppState({
    projectsDir,
    fsEventSource,
    // Pass a proxy that always delegates to the current clientChannel so the
    // server.ts swap takes effect for all subsequent broadcasts.
    clientChannel: {
      broadcast: (msg) => clientChannel.broadcast(msg),
      close: () => clientChannel.close(),
    },
    uploadAuth: parseUploadAuthConfig(env),
  })

  await inner.start()

  return {
    listProjects: inner.listProjects.bind(inner),
    renderPage: inner.renderPage.bind(inner),
    search: inner.search.bind(inner),
    get searchVersion() { return inner.searchVersion },
    broadcast: inner.broadcast.bind(inner),
    get uploadAuth() { return inner.uploadAuth },
    start: inner.start.bind(inner),
    shutdown: inner.shutdown.bind(inner),
    siteConfigCacheHas: inner.siteConfigCacheHas.bind(inner),
    projectsDir,
    setClientChannel(channel) {
      clientChannel = channel
    },
  }
}

/**
 * Read a file via the live-mode raw route. Convenience for callers that have
 * already validated to a SafePath — translates ENOENT/IO to typed errors.
 */
export async function readRawFile(safePath: SafePath): Promise<string> {
  try {
    return await readFile(safePath, 'utf-8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new VibedocsError('not-found', 'File not found', { cause: err })
    }
    throw new VibedocsError('io', 'Failed to read file', { cause: err })
  }
}
