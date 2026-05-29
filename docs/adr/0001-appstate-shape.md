# AppState shape: behavioural-verb interface with two ports for true-external deps

**Status:** accepted

`src/server.ts` historically tangled 8 concerns at module scope (caches, search index, watcher, broadcaster, resolvers, upload auth, HTTP boot, route declarations) with no testable seam. Issue [#92](https://github.com/danielcbright/vibedocs/issues/92) extracts an `AppState` module owning live-mode runtime state. The boundary is scope **B+**: caches + search index + File-system Event Source + broadcaster + upload auth are INSIDE; path resolvers and HTTP boot stay OUTSIDE (see [CONTEXT.md](../../CONTEXT.md) for the term definitions).

We ran `architecture-design-it-twice` and considered four shapes (full report: [docs/appstate-design-it-twice-2026-05-29.md](../appstate-design-it-twice-2026-05-29.md)). We picked **Design C (behavioural-verb interface) as the base** and grafted **two ports from Design D** (`FsEventSource` and `ClientChannel`) for the two true-external dependencies that benefit from adapter discipline. The other six ports from D were rejected as ceremony — the wrapped modules are already factory-shaped and tests can pass stubs directly.

## Considered options

- **A — minimal `Request → Response` interface.** Rejected: highest depth ratio but smuggled path resolvers into the factory closure, violating the spec's scope boundary. The "one door" framing required a `__tap` test affordance that admitted the door wasn't really one.
- **B — event-grammar interface (`AppEvent` discriminated union + capability registry).** Rejected: maximally evolvable but operationally fragile — critical invariants (e.g. "site-config invalidation happens before broadcast") become subscriber-order dependent. Evolvability vibedocs doesn't need; vibedocs has zero plugin pressure.
- **C — behavioural-verb interface (`listProjects`, `renderPage`, `search`, `broadcast`, `uploadAuth`).** Picked as base: matches how routes already think, hits the actual change pressure (testable watcher fan-out + legible boot), respects every constraint without rationalisation.
- **D — ports-and-adapters with 8 typed ports.** Rejected as a whole; 2 ports grafted into C: `FsEventSource` (Chokidar prod, in-memory test) and `ClientChannel` (`ws` prod, in-memory test). The other 6 ports wrapped modules that are already factory-shaped — ceremony for ceremony's sake.

## Why two ports specifically, not zero and not eight

Skill principle: *"One adapter means a hypothetical seam. Two adapters means a real one."*

- **Chokidar (file-system watcher)** is a true external dep. Tests cannot drive real file events deterministically. An in-memory `FsEventSource` adapter pays for itself the first time a watcher-ordering bug surfaces.
- **`ws` (WebSocket library)** is a true external dep. Asserting on broadcast behavior requires either real sockets or a fake. An in-memory `ClientChannel` adapter records `sent[]` for direct assertion.
- **Search index, site-config cache, project discovery, renderer** are in-process and already factory-shaped. Tests pass stubs directly; wrapping them in ports adds a layer of indirection without earning the "two-adapter" leverage.

## Consequences

- `src/server.ts` collapses to ~80 LOC of composition-root wiring (target was ≤150).
- Path resolvers (`docResolver`, `assetResolver`) stay module-level in `server.ts` — they are stateless allocations, not runtime state.
- Build mode (`renderProject`) imports nothing from `app-state.ts`. The two render modes share no orchestration code.
- AppState is constructable in tests without HTTP — drive `FsEventSource` events synchronously, assert on `ClientChannel.sent` and `state.searchVersion`.
- Future feature: debounced search rebuilds will require a `Clock` port (also from D). Defer that port until debouncing is actually implemented.
