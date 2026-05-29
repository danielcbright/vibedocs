# Design It Twice: AppState orchestration module

## Problem framing

**Summary.** `src/server.ts` is 331 LOC mixing eight distinct concerns: project + site-config caches, search index, chokidar file-system event source, WebSocket broadcaster, path resolvers, upload auth config, HTTP boot, and route declarations. There is no named seam for live-mode runtime state. Tests can only exercise the wiring by starting an HTTP server.

**Goal.** Extract `AppState` as the single named seam for live-mode runtime state. Inside AppState: project cache, site-config cache, search index, File-system Event Source, WebSocket broadcaster, upload auth config. Outside (stays module-level in server.ts): path resolvers (stateless), HTTP server lifecycle, route declarations themselves. Target: server.ts shrinks to ~165 LOC of pure route wire-up + lifecycle. AppState must be constructable and drivable in tests without spinning up HTTP.

**Hard constraints (apply to every design):**

1. Path resolvers (`docResolver`, `assetResolver`) stay module-level in server.ts — stateless allocations, not runtime state.
2. AppState applies to LIVE Render Mode only. Build mode's `renderProject()` runs standalone with no AppState dependency.
3. Watcher events must flow through AppState — no direct chokidar event handlers in server.ts after extraction.
4. Upload auth config is owned by AppState; routes access it via constructor injection or `c.set()` middleware.
5. The File-system Event Source subscriber list is an internal AppState detail, never exposed on its public interface.
6. AppState must be constructable + drivable in tests without HTTP.
7. Lifecycle: `start()` for watcher init, `shutdown()` for cleanup (close watcher, drain pending rebuilds).
8. Upload auth config is parsed once at boot; routes read it but never mutate. No re-reading env during request handling.
9. WS broadcaster tolerates client disconnect mid-broadcast; per-client send errors swallowed.
10. Watcher handler errors must not crash the loop — log and continue.

**Dependencies (categorised):**

- **True-external:** `chokidar` (file-system watcher); `ws` (WebSocketServer + WebSocket).
- **In-process collaborators (owned by AppState):** `createIndexStore`, `createSiteConfigCache`, `UploadAuthConfig`.
- **In-process utilities (imported, not owned):** `renderSinglePage`, `discoverProjects` + `filterProjects`, `isMarkdownPath`, `toProjectRelativePath`, `MARKDOWN_EXTENSIONS`, `EXCLUDED_DIRS`, `reloadMessage` / `refreshTreeMessage`.
- **Stays external:** `PathResolver` instances; `parseAllowedOrigins` / `buildVerifyClient` (HTTP boot concern); route registration helpers.

**Illustrative sketch (the spec's baseline shape):**

```ts
interface AppStateConfig {
  projectsDir: string
  loadSiteConfig: (projectPath: string) => Promise<SiteConfig | null>
}
class AppState {
  private searchStore: IndexStore
  private siteConfigCache: SiteConfigCache
  private uploadAuthCfg: UploadAuthConfig
  private watcher: chokidar.FSWatcher | null = null
  private wsClients = new Set<WebSocket>()

  constructor(cfg: AppStateConfig, uploadAuthCfg: UploadAuthConfig) { /* ... */ }
  async start(watcher: chokidar.FSWatcher, wsServer: WebSocketServer) { /* ... */ }
  async shutdown() { /* ... */ }

  getUploadAuthConfig(): UploadAuthConfig
  async render(safePath: SafePath, project: string, docPath: string): Promise<HtmlPage>
  broadcast(message: WsMessage): void

  private onFileChange(filePath: string) { /* invalidate → broadcast → rebuild */ }
}
```

The four designs below all replace this baseline. They diverge on **how narrow the interface should be**, **where the seam sits**, and **how much abstraction to introduce for testability**.

---

## Design A — minimal interface

**Constraint:** Minimise the interface — aim for 1–3 entry points max. Maximise leverage per entry point.

### Interface

Collapse AppState's surface to a single async factory and a single public method — `handle(req)`. All route declarations move *inside* AppState. The outside world sees `Request → Response`. Plus two lifecycle hooks (`attachWebSocket(server)`, `close()`) that aren't really part of the interface — they're how you turn it off.

```ts
export interface LiveApp {
  readonly handle: (req: Request) => Response | Promise<Response>
  attachWebSocket(server: Server): void
  close(): Promise<void>
}

export function createAppState(opts?: CreateAppStateOptions): Promise<LiveApp>
```

Options allow overriding `projectsDir`, `env`, `loadSiteConfig`, `watcherFactory`, and `awaitInitialIndex` for tests. No `getProjects()`, no `render()`, no `broadcast()`, no `getUploadAuthConfig()` — those are internal because callers don't exist outside HTTP.

### Usage

```ts
// src/server.ts (~20 LOC)
const app = await createAppState()
const server = serve({ fetch: app.handle, port: PORT })
app.attachWebSocket(server as unknown as Server)
process.on('SIGTERM', async () => { await app.close(); server.close() })
```

Tests drive AppState by constructing `new Request(...)` and asserting on the Response. A fake watcher is injected via `watcherFactory`; events trigger broadcast via a hidden `__tap()` for assertions.

### Behind the seam

Project + site-config caches, search index, chokidar watcher, WebSocket broadcaster, upload auth, path resolvers (yes, moved inside), route registration, console banners, initial search build, coalescing rebuild logic — *everything* lives behind the factory closure.

### Dependency strategy

- **True external:** `chokidar.FSWatcher` (via `watcherFactory` option) — the one real seam. `process.env` (via `env` option).
- **WebSocket:** hidden; a test-only `__tap()` method for asserting broadcast payloads (acknowledged as a hidden third door).
- **In-process collaborators:** all owned, never exposed. `loadSiteConfig` injectable; the rest imported directly.

### Trade-offs

**High leverage:** server.ts collapses to ~20 LOC. One door removes "which seam do I call?" Initial-build coordination becomes a single `await`. Watcher-driven concerns merge into one switch.

**Honest costs:**
- `handle(req): Response` is too narrow for inspection tests — checking "was the search index rebuilt?" requires going through `/api/search`.
- Static file + SPA fallback handlers don't belong in AppState but live there anyway. Cohesion violation.
- Path resolvers are claimed external but actually live inside the factory closure — violates the spec.
- The WS `__tap` is a hidden third adapter. The advertised "one door" is closer to "one door plus a side window."
- One async factory means startup ordering is opaque — partial failure has no introspection point.

---

## Design B — flexible

**Constraint:** Maximise flexibility — support many use cases and extension. Trade interface surface for the ability to evolve without breaking callers.

### Interface

Three primitives — **event bus**, **capability registry**, **lifecycle controller** — replace the narrow method quartet. Callers compose features by subscribing to events and resolving capabilities.

```ts
export interface AppState {
  on<K extends AppEventKind>(kind: K, fn: Subscriber<K>): Unsubscribe
  emit<K extends AppEventKind>(event: EventOf<K>): void
  register<K extends CapabilityKey>(key: K, impl: Capabilities[K]): void
  resolve<K extends CapabilityKey>(key: K): Capabilities[K]
  start(): Promise<void>
  shutdown(): Promise<void>
  readonly state: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped'
  readonly stats: { subscribers: number; capabilities: number; wsClients: number }
}
```

Ten event kinds (`fs.changed`, `fs.site-config`, `search.rebuilt`, `ws.broadcast`, etc.). Nine capability keys (`projects.discover`, `search.query`, `render.page`, `ws.broadcast`, `fs.watch`, `clock.now`, etc.). Capabilities freeze after `start()`.

### Usage

```ts
const appState = createAppState({
  projectsDir: PROJECTS_DIR,
  capabilities: { /* nine keys */ },
})
appState.on('fs.changed', async (e) => {
  if (e.isMarkdown) {
    appState.resolve('ws.broadcast')(reloadMessage(e.relPath))
    appState.resolve('search.rebuild')()
  } else {
    appState.resolve('ws.broadcast')(refreshTreeMessage())
  }
})
await appState.start()
```

New runtime concerns become pure additions — e.g. metrics are zero-touch on AppState:

```ts
appState.on('search.rebuilt', (e) => prom.searchRebuildMs.observe(e.durationMs))
```

### Behind the seam

The event-bus dispatcher (Map + per-subscriber try/catch + snapshot iteration). The capability table with freeze-on-start. A default fs-subscriber bundle wired during `start()`. Rebuild coalescing closure. The state machine. The WebSocket client set lives in the `ws.broadcast` capability's closure — AppState never sees a `WebSocket` directly.

### Dependency strategy

- **True external (capability boundary):** `chokidar` via `fs.watch` capability; `ws` via `ws.broadcast` capability registered after WS server boots.
- **In-process (capability table, no compile-time deps):** search, site-config, render, discover, upload auth all wired via the registry.
- **Types only at AppState core** — no runtime imports of chokidar/ws/search/render.

### Trade-offs

**High leverage:** Metrics, audit, request-correlation IDs, hot-reload — all become `on(...)` subscribers or new capability slots. Tests inject fake capabilities, drive `emit()`, assert effects. No HTTP required. Alternative event sources pluggable.

**Honest costs:**
- Interface surface is NOT small. Two type parameters, nine capability keys, ten event kinds, four lifecycle methods.
- Capability-table indirection adds a `resolve()` hop per call. Jumping-to-definition lands on `resolve()`, not `renderSinglePage`.
- Event-bus indirection hides ordering bugs. Today's chokidar block has visible order; after refactor, ordering is split across subscribers in registration order.
- Freeze-on-start prevents legitimate dynamic registration (e.g. hot-reload upload token on SIGHUP).
- **YAGNI risk is genuine.** Vibedocs has ONE live deployment, ONE broadcaster, ONE search store. Pays for plugability that may never be exercised.
- TypeScript ergonomics: conditional types around the event subscriber map produce ugly inference failures with inline subscribers.

**Honest summary by the author:** "this is the right shape if vibedocs is heading toward multi-tenant, multi-event-source, observability-instrumented territory. If it stays a single-user docs viewer, the simpler narrow-interface design wins on readability and would be the correct call."

---

## Design C — common-caller

**Constraint:** Optimise for the most common caller. The 90% path should be one line.

### Interface

The most common caller is `bin/vibedocs serve` (and its test twin). Today that's ~150 LOC of boot wiring. We want that to drop to one line: `const live = await runLive(env)`. Everything else is implied by "live mode."

```ts
export interface LiveServer {
  app: Hono
  httpServer: Server
  state: AppState
  shutdown(): Promise<void>
}

export interface AppState {
  listProjects(opts?: { fileType?: 'markdown' | 'all' }): Promise<Array<ProjectSummary & { siteConfig: SiteConfig | null }>>
  renderPage(safePath: SafePath, project: string, docPath: string): Promise<RenderedPage>
  search(query: string, maxResults?: number): SearchResult[]
  readonly searchVersion: number
  uploadAuth: Readonly<UploadAuthConfig>
  broadcast(message: WsMessage): void
  readonly clientCount: number
}

export async function runLive(env?: NodeJS.ProcessEnv): Promise<LiveServer>
export function createAppState(opts: CreateAppStateOptions): AppState & { start(): Promise<void>; shutdown(): Promise<void>; attachWebSocketServer(wss: WebSocketServer): void }
```

Tests use the verbose `createAppState({...})` with `FsEventSource` and `Broadcaster` adapter slots. Production uses `runLive(env)` — zero parameters.

### Usage

```ts
// bin/vibedocs-serve.ts — the entire production entry point
const live = await runLive(process.env)
process.on('SIGINT', async () => { await live.shutdown(); process.exit(0) })
```

Routes consume AppState only:

```ts
app.get('/api/render/:project/*', async (c) => {
  const safePath = docResolver.resolve(project, docPath)
  const page = await state.renderPage(safePath, project, docPath)
  return c.json({ data: { html: page.html, toc: page.toc } })
})
```

Tests inject fakes per factory:

```ts
const state = createAppState({
  projectsDir: '/tmp/test-projects',
  uploadAuth: { token: null, readOnly: true, maxBytes: 0 },
  watcherFactory: () => fakeWatcher,
  broadcasterFactory: () => fakeBroadcaster,
})
await state.start()
fakeWatcher.emit('change', '/tmp/test-projects/my-proj/README.md')
await waitFor(() => state.searchVersion > v0)
```

### Behind the seam

All env-var parsing collapses to one `parseLiveEnv(env)`. Factory construction order enforced. WebSocket connection lifecycle. The five chokidar event handlers collapse into one `onFsEvent(kind, path)` dispatcher. "Broadcast before rebuild" ordering becomes a deterministic line. "Initial rebuild before HTTP ready" coordination — `runLive` awaits both. `uploadAuth` is frozen via `Readonly<>`.

### Dependency strategy

- **True external (adapter pair on day one):** `FsEventSource` (chokidar prod / EventEmitter test), `Broadcaster` (ws prod / in-memory test).
- **In-process owned:** `IndexStore`, `SiteConfigCache`, `UploadAuthConfig` — already factory-shaped, no wrapping interface.
- **Stateless utilities:** discover, render, message constructors — imported directly.
- **Stays external:** `PathResolver` instances, `parseAllowedOrigins`, `buildVerifyClient`, Hono `app` itself.

**Rule:** one adapter = hypothetical seam; two = real. Both watcher and broadcaster get two adapters on day one.

### Trade-offs

**High leverage:**
- The watcher dispatcher: one `onFsEvent` method replaces five duplicated handlers.
- Test reachability: change→broadcast→rebuild becomes a <10ms synchronous test.
- `Readonly<UploadAuthConfig>` enforces "no env re-reads" at the type system level.

**Honest costs:**
- `listProjects()` is barely deeper than raw discover + cache calls. Saves three lines, adds a method.
- `renderPage()` is pass-through with `'live'` hard-coded.
- `runLive` vs `createAppState` split is almost-but-not-quite duplication (mitigated: runLive calls createAppState).
- Four factory slots is ceremony for tests that use one or two.
- "Single internal queue" claim is aspirational — actually delivering serialised events needs a mutex; cleaner to weaken the invariant.
- `broadcast()` on the public interface leaks that AppState is the broadcaster.

**Author's summary:** "the extraction is worth it for the watcher dispatcher and test reachability. The other methods (`listProjects`, `renderPage`) are along for the ride to give AppState a coherent surface, but they don't justify the work on their own."

---

## Design D — ports-and-adapters

**Constraint:** Design around ports for every external dependency. Ship a production adapter and an in-memory test adapter.

### Interface

`AppState` is a thin orchestrator. The seams are the **ports**: every cross-boundary dependency is an interface.

```ts
export interface FsEventSource {
  subscribe(listener: (event: FsEvent) => void): () => void
  ready(): Promise<void>
  close(): Promise<void>
}
export interface ClientChannel {
  broadcast(message: WsMessage): void
  clientCount(): number
  close(): Promise<void>
}
export interface SearchIndexPort { /* ... */ }
export interface SiteConfigPort { /* ... */ }
export interface ProjectsPort { /* ... */ }
export interface RendererPort { /* ... */ }
export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): () => void }
export interface Logger { /* ... */ }

export interface AppStateDeps {
  fsEvents: FsEventSource; channel: ClientChannel; searchIndex: SearchIndexPort
  siteConfig: SiteConfigPort; projects: ProjectsPort; renderer: RendererPort
  clock: Clock; log: Logger
  projectsDir: string; uploadAuth: UploadAuthConfig
  searchRebuildDebounceMs?: number
}

export class AppState {
  constructor(private readonly deps: AppStateDeps)
  async start(): Promise<void>
  async shutdown(): Promise<void>
  getProjects(filter?: FileTypeFilter): Promise<ProjectWithConfig[]>
  getUploadAuthConfig(): UploadAuthConfig
  getSearchIndex(): SearchIndexPort
  render(safePath: SafePath, project: string, docPath: string): Promise<HtmlPage>
  broadcast(msg: WsMessage): void
  drain(): Promise<void>  // test affordance — resolves when pending work flushes
}
```

ESLint rule: no production code imports `chokidar` or `ws` except inside `src/app-state/adapters/`.

### Usage

server.ts is ~80 LOC of pure composition-root wiring. Tests construct AppState with `InMemoryFsEventSource`, `InMemoryClientChannel`, `fakeClock()`, drive events synchronously, advance the clock to fire debounced rebuilds, await `drain()`, assert.

```ts
fs.emit({ kind: 'change', absPath: '/projects/foo/a.md', isDir: false })
await appState.drain()
expect(ch.sent).toEqual([{ type: 'reload', path: 'foo/a.md' }])
expect(rebuildCount).toBe(1)  // debouncing
clock.advance(250)
await appState.drain()
expect(rebuildCount).toBe(2)  // one coalesced rebuild
```

### Behind the seam

Chokidar event taxonomy normalisation. Watcher-to-action fan-out (one `dispatch(event)`). Debounce + coalescing via injected `Clock`. WebSocket client lifecycle. Initial-scan ordering. Shutdown ordering. Upload-auth config freezing. Error containment.

### Dependency strategy

Adapter pairs:

| Dependency | Production | Test |
|---|---|---|
| chokidar | `ChokidarFsEventSource` | `InMemoryFsEventSource` with `.emit()` |
| ws | `WsClientChannel` | `InMemoryClientChannel` with `sent[]` |
| Date.now + setTimeout | `systemClock` | `fakeClock()` with `advance(ms)` |
| console | `consoleLogger` | `silentLogger` / `recordingLogger` |

In-process ports wrap already-factory-shaped modules (`SearchIndexPort` over `createIndexStore`, etc.).

### Trade-offs

**High leverage:**
- Watcher + WS testability is transformational. Change→broadcast→rebuild becomes a millisecond-fast pure unit test with deterministic ordering.
- Debounce/coalescing becomes testable via the `Clock` port.
- Shutdown ordering becomes expressible — vitest stops hanging.
- Composition root caps blast radius for new dependencies.

**Honest costs:**
- **Eight ports for one module is heavy.** Four of them (`SearchIndexPort`, `SiteConfigPort`, `ProjectsPort`, `RendererPort`) are near-trivial wrappers over already-factory-shaped functions.
- `Clock` port pays off only if we add debounce.
- Adapter file proliferation: 4 files → ~12 files.
- `drain()` leaks implementation detail.
- `WsClientChannel.attach(httpServer, origins)` is awkward two-phase construction.

**Author's summary:** "this design is correct but *bigger than the problem*. If the team's actual pain point is just 'I want to unit-test the watcher fan-out without HTTP,' a 60-LOC `LiveOrchestrator` class with just `FsEventSource` + `ClientChannel` ports (skipping the in-process ones) would deliver 80% of the value at 30% of the surface area."

---

## Comparison

All four designs agree on the diagnosis: server.ts has eight concerns tangled at module scope and no way to drive the watcher → invalidate → broadcast → rebuild loop from a test without booting HTTP. They diverge sharply on how much of the orchestration to elevate into a typed contract.

### Depth (leverage per unit of interface)

Design A has the highest depth ratio. One async factory + one `handle(req)` method buries the entire eight-concern tangle behind a `Request → Response` contract. server.ts goes from 331 LOC to ~20 LOC — but the depth is bought by absorbing concerns that arguably don't belong (static file serving, SPA fallback) and by smuggling in a `__tap` for test inspection. The advertised "one door" is closer to "one door plus a side window."

Design B is the shallowest interface-per-LOC. Two type parameters, nine capability keys, ten event kinds, four lifecycle methods. Depth is distributed across many small typed slots rather than concentrated. For a single-tenant docs viewer, this is depth in the wrong dimension.

Design C optimises depth at the **boot site** rather than the runtime site. `runLive(env)` is a true one-liner that hides all eight concerns of env parsing + factory ordering + initial-rebuild coordination. The runtime surface itself is moderately deep — `renderPage` and `listProjects` are honestly admitted as nearly pass-through. Depth is asymmetric: very deep at the entry, shallow at the methods.

Design D has high depth per port for the two that matter (`FsEventSource`, `ClientChannel`) and almost no depth for the other six. The deep ports are extremely deep; the shallow ports are ceremony.

### Locality (where change concentrates)

Design A concentrates *all* change behind a single factory. Excellent for ownership and review but `app-state.ts` becomes the new 300+ LOC mega-module. The same problem moved one layer down with better encapsulation.

Design B distributes change across event subscribers and capability registrations. Additive change is excellent; diagnostic work ("why didn't the broadcast happen?") requires inspecting subscriber registration order across multiple files.

Design C draws a clean line: boot-time changes in `runLive` / `server.ts`, runtime changes in AppState methods, watcher fan-out in one `onFsEvent` dispatcher. Three obvious homes.

Design D concentrates change at the composition root with strict lint enforcement. The most disciplined locality story — and the most ceremonious.

### Seam placement

Design A places the seam at the HTTP boundary. Honest about what AppState *does*, but ignores the constraint that path resolvers stay external. Admits this and rationalises that they move into the factory closure — which violates the spec's "stay module-level in server.ts." **The seam is in the wrong place by the candidate's own rules.**

Design B places the seam at *event grammar* — the contract is the `AppEvent` discriminated union, not a method list. The most evolvable seam but also the most abstract. The "site-config invalidation before broadcast" invariant is critical and easy to break across subscriber registrations. Architecturally pure but operationally fragile.

Design C places the seam at *behavioural verbs* — `renderPage`, `search`, `broadcast`, `listProjects`. Matches how routes already talk and how a reader thinks about the system. Path resolvers correctly stay external. **The seam is in exactly the spec'd location and respects every named constraint.**

Design D places seams at *every* cross-boundary dependency. Eight ports is too many for the actual change pressure. The two that matter place their seams exactly where the test-pain is; the other six are ports for ports' sake.

### Cross-cutting observations

- Only C and D respect the path-resolver-stays-external constraint cleanly. A blurs it; B doesn't address it explicitly but most naturally leaves it external.
- Only D and (partially) C address debouncing/coalescing search rebuilds. A and B inherit today's "rebuild per event" via fire-and-forget.
- Only D introduces a `Clock` port — the right call for testing rebuild-coalescing policy without `setTimeout` flakiness, but only matters if we add debounce.
- The `drain()` affordance in D is the most honest answer to "how do tests know all pending work is done?" B punts via subscriber-fire-and-forget; A relies on awaiting the next HTTP request; C uses `waitFor(searchVersion > v0)`.
- B's freeze-on-start, A's process.env snapshot, and C's `Readonly<UploadAuthConfig>` are three expressions of the same safety property. C's is the cleanest because it's enforced at the type system.
- All four agree build-mode bypasses AppState. None threaten this boundary.

---

## Recommendation

**Pick Design C (common-caller) as the base, graft Design D's two real ports onto it.**

Vibedocs is a single-tenant docs viewer with one watcher, one broadcaster, one search store. The change pressure that actually matters is (1) making the watcher fan-out testable without HTTP, (2) making boot legible, and (3) respecting the documented "what stays inside vs outside AppState" boundary. Design C hits all three directly. Its surface (`listProjects`, `renderPage`, `search`, `broadcast`, `uploadAuth`) matches how routes already think; its `runLive` one-liner is the most leverage-per-keystroke at the call site that exists 99% of the time (boot); and it's the only design that honors the spec's path-resolver constraint without rationalisation.

But C's weakest point is its honesty gap on the watcher: it claims a `FsEventSource` adapter exists, but its test example still uses a `makeFakeWatcher` helper without the typed port discipline that makes the test bulletproof. This is exactly what Design D nails. Graft these two pieces from D into C:

1. **Adopt D's `FsEventSource` port and `ChokidarFsEventSource` / `InMemoryFsEventSource` adapter pair as-is.** This is the single highest-leverage extraction in any of the four designs. It pays for itself the first time a watcher-ordering bug is caught in a deterministic test.
2. **Adopt D's `ClientChannel` port and its two adapters.** Routes still call `state.broadcast(msg)`; AppState delegates to `channel.broadcast(msg)`. Isolates `ws` to one file; the in-memory channel records `sent[]` for assertions.

**Do not adopt D's other six ports.** `SearchIndexPort`, `SiteConfigPort`, `ProjectsPort`, `RendererPort` are ceremony — the underlying modules are already factory-shaped, tests can pass stubs directly without wrapping interfaces. Adding them would push AppState toward Design B's surface area without B's evolvability payoff. The `Clock` port is worth adopting *only if* we commit to adding debounced rebuilds in the same change; otherwise defer.

**Explicitly reject from each design:**

- **From A:** the "one door" framing — putting static file serving and SPA fallback inside AppState confuses the seam. Reject the `__tap` test affordance; D's `drain()` is the honest version.
- **From B:** the event-bus + capability-registry pattern. Evolvability is real but vibedocs has zero plugin pressure. YAGNI.
- **From C:** the `searchStoreFactory` and `siteConfigCacheFactory` options. Tests can construct stubs that satisfy port shapes directly; injecting full factories is overkill.
- **From D:** every port that isn't `FsEventSource` or `ClientChannel`.

**Final shape:** Design C's `runLive` + `createAppState` + narrow behavioural interface, with D's two true-external ports and their adapter pairs slotted in for `fsEvents` and `channel`. server.ts collapses to ~80 LOC of composition-root wiring (D's number, accurate for this hybrid). Tests construct AppState with `InMemoryFsEventSource` + `InMemoryClientChannel` + stub functions for the in-process collaborators, drive events synchronously, assert on `channel.sent` and `state.searchVersion`. Path resolvers stay module-level in server.ts. Build mode imports nothing from this module. Every spec'd constraint is honored.

**If forced to pick a single design without grafting: Design C.** It's the only one that respects every documented constraint without rationalisation, matches the actual change pressure on this codebase, and admits its own weak points (`listProjects` and `renderPage` being near pass-through) honestly enough that future readers will know which parts to harden vs accept.
