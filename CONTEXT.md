# Vibedocs

A self-hosted markdown documentation browser. Single Hono server discovers projects in a workspace root, renders markdown on demand for live browsing, and optionally builds the same projects into a static site for publication. One renderer; two delivery modes.

## Language

### Rendering

**Render Mode**:
The selector that controls URL shape in rendered HTML. Two values: `live` (server-rendered per request, internal markdown links keep `.md` extensions so the SPA hash-router intercepts them, assets resolve to `/api/file/<project>/<path>`) and `build` (rendered once into a static site, internal markdown links rewritten to clean URLs like `./install/`, assets become relative paths to mirrored files). Set at the call site, not propagated through the pipeline.
_Avoid_: "live mode" / "build mode" used as standalone phrases — they're values of Render Mode, not separate concepts.

**URL Rewriter**:
The pure mapping from a markdown link/image URL plus a Render Mode plus a current-doc context to its destination URL on the rendered page. Lives in `src/url-rewriter.ts` as a rehype plugin factory. The single canonical place where "which URL shape do we emit?" is answered.
_Avoid_: "asset rewriter," "URL rewrite logic," "link rewriter" — one term, all link/asset URL transformations.

**Markdown Processor**:
A configured unified pipeline (remark → rehype → shiki → mermaid → rewrite → sanitize → stringify) ready to convert one markdown document to one HTML string. Constructed per-page by the factory in `src/markdown-processor.ts` because the URL Rewriter captures per-page state.
_Avoid_: "renderer" (overloaded with the higher-level `renderProject`), "markdown engine."

**Reference Collector**:
A receiver that records every asset URL the URL Rewriter resolves while rendering. Used during `build` to detect references to files that don't exist (missing refs). One instance per project build. Lives in `src/reference-collector.ts`.
_Avoid_: "ref tracker," "link collector."

### Orchestration

**AppState**:
The single named seam that owns runtime state in **live** Render Mode: the project cache, site-config cache, search index, file-system event source, WebSocket broadcaster, and upload auth config. Constructed once at startup; drivable from tests without HTTP. Stateless allocations (path resolvers) stay module-level outside AppState. Build mode does not use AppState — `renderProject` runs standalone.
_Avoid_: "app context," "server state," "globals" — AppState is the named module that replaces what would otherwise be implicit module-level state in `server.ts`.

**File-system Event Source**:
The chokidar watcher rooted at the workspace `PROJECTS_DIR`. Emits events that subscribers consume: site-config cache invalidates, search index rebuilds, WebSocket broadcaster sends `reload` / `refresh-tree` to connected clients. Owned by AppState; the wiring between events and subscribers is internal to AppState.
_Avoid_: "watcher" (overloaded with frontend "live reload watcher"), "chokidar" (the library, not the concept).

### Discovery & policy

**Project**:
A directory under the workspace root containing at least one markdown file. Discovered at startup and on file-system events. Each Project has a tree of files (markdown + asset).
_Avoid_: "repo," "site" (a Project might become a static site at build time, but a Project itself is the source unit).

**Excluded Paths Policy**:
The set of directory names (`node_modules`, `.git`, `dist`, etc.) that Discovery, Search, and the security boundary all skip. Single source of truth in `src/excluded-paths.ts`. Adding a name to the policy propagates everywhere automatically.
_Avoid_: "ignore list" (sounds like `.gitignore` — these are not gitignore semantics), "blocklist."

**Safe Path**:
A branded type returned by the `PathResolver` after a path passes traversal-defense + project-root containment. Every filesystem-touching operation in the server requires a Safe Path argument, making the validation invariant unforgeable at the type level.

### Upload

**Upload Pipeline**:
An ordered list of gate functions through which every `POST /api/upload/*` request flows. Each gate is a pure check returning either `'continue'` or a typed rejection. Phase-tagged (`'auth' | 'content'`) so auth gates run before multipart body parsing for unauthenticated requests. Lives in `src/upload-pipeline.ts`.
_Avoid_: "upload middleware" (it's not a Hono middleware chain — it's a typed sequence inside one handler), "upload validator" (singular — there are six gates).

## Relationships

- **AppState** owns the project cache, site-config cache, search index, **File-system Event Source**, WebSocket broadcaster, and upload auth config — all live-mode runtime state
- The **File-system Event Source** publishes events that AppState's subscribers consume (cache invalidation, search rebuild, WS broadcast)
- A **Project** is rendered into one or more **Pages** by the **Markdown Processor**
- The **Markdown Processor** delegates URL transformation to the **URL Rewriter**
- The **URL Rewriter** consults the current **Render Mode** for every link/asset
- In `build` mode, the **URL Rewriter** notifies the **Reference Collector** of every resolved asset URL
- The **Excluded Paths Policy** is read by Discovery, Search, and `PathResolver` — they cannot diverge
- Every server route that touches the filesystem accepts a **Safe Path**, never a raw string
- Every `POST /api/upload/*` request flows through the **Upload Pipeline** before touching disk

## Flagged ambiguities

- "Renderer" historically referred to both the per-page **Markdown Processor** and the whole-project orchestration in `renderProject`. Resolved: use **Markdown Processor** for the per-page pipeline; `renderProject` is the orchestration function and not yet a named domain concept.
- "Asset" can mean either a non-markdown file in a Project (PNG, PDF) OR an HTML asset (JS bundle, CSS) emitted by the build. Resolved: a **Project Asset** is the former; **Build Output** covers the latter. Only **Project Asset** appears in markdown-rendering vocabulary.
