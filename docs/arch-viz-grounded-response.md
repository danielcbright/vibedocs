# Grounded Response to the Adversarial Reviewer's 12 Questions

> Companion to [arch-viz.md](./arch-viz.md), [arch-viz-adversarial-review.md](./arch-viz-adversarial-review.md), and [arch-viz-counter-review.md](./arch-viz-counter-review.md). The reviewer pushed back with 12 high-leverage questions designed to separate folklore from receipts. This is what the actual code says.

## Two corrections before the answers

I owe these upfront — better to surface them than let them quietly weaken everything else.

1. **There is no render cache.** I previously claimed `server.ts:63` was a render cache. Re-reading: that's `siteConfigCache` (parsed `.vibedocs.config.ts` per project). The `/api/render/:project/*` route at `server.ts:95` calls `renderSinglePage` raw, every request, full unified pipeline. **The reviewer's "on-demand rendering on every request" critique is literally correct.** Recommendation R3 ("cache aggressively") is therefore *not* already done.

2. **Workspace watcher scale is real-ish.** Chokidar watches `~/workspace/projects/**/*` = **2,475 files** today (excluding `node_modules`/`.git`/`dist`). Not the reviewer's 50k strawman, but not trivial either. One `git pull` on a large project can fire dozens of events.

---

## Core renderer & mode handling

### Q1 — Mode flag surface area outside `render.ts`

Outside the renderer, the `mode` literal appears in exactly **two** places:

- `src/server.ts:95` — `renderSinglePage(safePath, project, docPath, 'live')` (hard-coded)
- `src/cli/build.ts:169` — `renderProject(projectPath, siteConfig, 'build')` (hard-coded)

That's the entire propagation. The sidebar, the SEO injection (slice #50, not yet built), and asset handling do NOT consume the mode flag — they branch on `siteConfig` presence or run unconditionally per-call-site. The mode flag has a single dimension (URL shape inside the renderer) and a single hand-off (which call site you came from). It does not propagate.

### Q2 — Purity of `renderMarkdownForPage`

Verified pure. No `fs`, no `process.env`, no global state. Inputs: `content: string` + `RewriteOptions { mode, projectName, currentDocPath }`. Output: HTML string. The fresh `unified()` processor is constructed per-call to capture `currentDocPath` in the rewrite plugin closure (`render.ts:324-327`). Shiki's highlighter cache is the only cross-call state and it's an upstream singleton, not vibedocs-owned.

### Q3 — Preview fidelity gap today

Walking a Mode B project on `:8080`:

| Surface | Mode A preview | Mode B ship | Diverges? |
|---|---|---|---|
| Sidebar nav | Curated (#52: branches on `siteConfig.nav`) | Curated | same |
| Article HTML | `renderSinglePage(... 'live')` | `renderProject(... 'build')` | **DIFFERS:** internal `.md` links keep `.md` extension (SPA hash-router intercepts) vs rewritten to clean `./docs/install/`; assets use `/api/file/<project>/<path>` vs relative `../diagram.png` |
| TOC | Same `extractToc()` call | Same | same |
| Theme tokens | Not scoped under `.vd-site-preview` (slice #51, not yet built) | Will be scoped | **DIFFERS** |
| Canonicals / `<head>` | Not emitted (live SPA owns the page) | Not yet emitted (slice #50) | N/A today |
| Hydration script | SPA always loaded | SPA bundled into `dist/assets/` unconditionally (`build.ts:208-213`) | both ship the SPA — see Q7 |
| Frontmatter parsing | `frontmatter: {}` (slice #50 stub) | Same stub | same |

The structural divergence is **URL shape** + **theme scope**. Both will exist as long as both modes exist; both are testable as equivalence assertions.

---

## Caching & performance

### Q4 — Render caching

*Does not exist.* No content-hash key, no config-hash key, no persistence across restarts. Every `/api/render` re-runs the unified pipeline including Shiki tokenization and Mermaid AST manipulation. On a fresh server start, hitting a 200-page demo repo would cost 200 cold renders.

I have not personally measured latency, but Shiki cold cost is typically 50–300ms per page depending on language count. The amortised case (after `@shikijs/rehype`'s singleton warms) is much better, but each hit still does the full remark/rehype traversal.

### Q5 — Watcher & index scale

2,475 files in the current workspace, no debouncing, no throttling — each chokidar event triggers either a search-index rebuild (for `.md`) or a `refresh-tree` WS broadcast (for anything else). I have NOT measured RSS under sustained churn. A `git checkout` of a 500-file branch would fire 500 events.

---

## Distribution & build (the load-bearing critique)

### Q6 — Consumer experience for #57 / PR #68

Target shape: a downstream repo (demo) adds `"vibedocs": "github:danielcbright/vibedocs#main"` to devDeps, then `npx vibedocs build`. The `prepare` script in `package.json` runs `npm run build && npm run build:cli`, which builds the frontend SPA into `frontend/dist/` and compiles the CLI to `dist-cli/`. `bin: vibedocs → dist-cli/cli/index.js`.

**What still ships that shouldn't:** the `files:` array in `package.json` includes `src/` — so consumers download the entire TypeScript source for the runtime server (`src/server.ts`, etc.) even though they'll only ever use `dist-cli/`. Not a security/correctness issue, but it's noise and contradicts the "easy adoption" goal.

**#65's pain:** `runBuild` mirrors *every* non-markdown file (`build.ts:200-205`). For the vibedocs repo itself, that means `dist/` ends up with `package.json`, `tsconfig.json`, `.ts` source, lockfiles, `LICENSE`, tests. The `EXCLUDED_DIRS` filter only stops `node_modules`/`.git`/`dist`. So today, if you `vibedocs build demo`, the public site at example.io will publish demo's source tree. Embarrassing on the day you flip the DNS.

### Q7 — Zero-JS option

No. `build.ts:208-213` copies `frontend/dist/assets/` to `<outDir>/assets/` unconditionally, and `composePageHtml` always emits the `<script type="module" src="...">` tag. Every reader of every page on example.io will download the full SPA bundle even if they only read one page and leave. The bundle exists for Mode A's live navigation; Mode B inherits it because that's the cheapest code path. The reviewer's "hydration tax" critique is real — no tree-shaking, no conditional emit.

---

## Navigation & config

### Q8 — Nav decision branch

One clean branch: `app-sidebar.tsx:507`

```tsx
if (project.siteConfig?.nav) { renderSiteNav(project) } else { renderFileTree(project) }
```

It does NOT leak into the renderer — `renderProject(projectPath, siteConfig, mode)` accepts `siteConfig` but only reads it to decide whether to emit `llmsTxt` (and later sitemap/robots). The URL-rewrite plugin doesn't touch `siteConfig.nav`. So nav-mode is purely a frontend concern.

### Q9 — Config loading divergence

- **Mode A:** `loadSiteConfig(projectPath)` is called per-project in `/api/projects` via `siteConfigCache.get()`. Cache invalidates on chokidar config events. Loading does esbuild-transform `.vibedocs.config.ts` → temp `.mjs` → dynamic `import()`.
- **Mode B:** `loadSiteConfig` is called once at `runBuild` start (`build.ts:161`), no cache.

**Same loader, same code path** — the only divergence is invocation cadence. Known leak: each invalidation in Mode A leaks one ESM module entry, tracked as #62.

---

## Feature gap readiness

### Q10 — MDX path

Current pipeline is unified/remark/rehype only, no MDX. Adding MDX would mean:

1. Swap `remarkParse` → `remark-mdx` or use `@mdx-js/mdx`'s compile
2. Teach `sanitizeSchema` about whitelisted component tags
3. Bridge the React component registry across modes (live: imported normally; build: must be SSR-renderable, otherwise hydration tax compounds)

Not architecturally precluded — but the sanitizer schema is a security boundary (`markdown-plugins.ts:9-11`) so loosening it for arbitrary components needs care.

### Q11 — Versioning hook

No existing metadata. `RenderResult` has no `version` field; `HtmlPage` has no version-aware URL. A Docusaurus-style "snapshot folder" approach would mean:

1. Add `version: string | null` to `SiteConfig`
2. Build CLI iterates declared version folders, calls `renderProject` per version, emits to `dist/v1/`, `dist/v2/`
3. Sidebar gets a version switcher

Greenfield; no existing hooks would help or hurt.

---

## Overall architecture

### Q12 — Cross-mode test contracts

`tests/render.test.ts` already does cross-mode equivalence:

- `:98-99` — external links untouched in both modes
- `:295-296` — image URL rewriting (both modes asserted)
- `:316, :378, :397` — `forEach mode in ['live','build']` rewriter edge cases

What's NOT tested cross-mode: full HTML structural equivalence (so a future renderer change could silently diverge them), TOC equivalence (same), sidebar + nav equivalence (no rendered-sidebar test exists). The contract is partial.

---

## Revised net read, after grounding

### Survived the code-check and got STRONGER

- **C5: Distribution friction.** Worse than initially admitted. `files:` ships `src/`, `runBuild` ships your whole source tree to `dist/`, every reader downloads the SPA. **Three concrete problems on the publish path, not one.**
- **C3 (sub-point): Hydration tax.** Confirmed unconditional SPA emit. Real, fixable.
- **C2: Render cost.** Was wrong to dismiss. **No render cache exists.** Reviewer was right.

### Survived and stayed the same

- **C4 (sub-point): Preview fidelity.** Two-axis divergence (URL shape + theme scope), testable.

### Got WEAKER on closer reading

- **C1: Mode flag will become a hairball.** Two external call sites, both hardcode their literal, mode does not propagate. Adding more output-axes (canonical, OG, robots) doesn't grow `mode` branches — they're `siteConfig`/`frontmatter`-gated. Even clearer now.
- **C4 (main thrust): Two sources of nav truth.** One frontend branch, doesn't leak.
- **R2: Need a proper intermediate representation.** `RenderResult` is the IR.
- **R4: Separate CLI from runtime.** `dist-cli/` is a separate compiled output via `tsconfig.cli.json` with its own `bin` entry.

### Implications for the revised review

- **Two of R1–R5 still stand:** R3 (cache) is now confirmed valid. R5 is generic but not wrong.
- **Mode A render-cost critique deserves promotion** from "scalability anxiety" to "this is unrendered every hit, here's the latency receipt." Concrete, fixable.
- **The reviewer's overall thesis ("dual-mode is a trap") still doesn't hold** — the trap doesn't materialize in the code. But the *specific* operational critiques (render cost, hydration tax, dirty `dist/`) are stronger than the counter-review credited.
