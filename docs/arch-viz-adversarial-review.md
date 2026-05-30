# Adversarial Review: VibeDocs Architecture

> Companion to [arch-viz.md](./arch-viz.md). A red-team take on the dual-mode design as it stands at sprint-vibedocs-pds slice 7/14. The author's framing is hostile by design; read it as a stress test, not a verdict.

The dual-mode design is elegant on paper — same renderer, two deployment shapes — but it's also a classic "works for me" architecture that will bite as soon as real usage appears. Here's the hostile take.

---

## 1. The Core Architectural Sin: Dual-Mode Schizophrenia

You claim the renderer is shared and pure. In practice it isn't, and never will be.

- `renderProject(..., mode)` with a flag that changes link rewriting sounds innocent until you need **one more** mode-specific behavior (canonical URLs, basePath, asset fingerprinting, robots meta, OpenGraph image generation, etc.).
- Every time you add a feature, you'll face the temptation to add another `if (mode === 'build')` branch. In six months the "pure" renderer will be a hairball.
- **Worse**: preview fidelity. Mode A uses live FS + auto nav. Mode B uses config-driven nav + frozen build. The preview you see on `:8080` is *not* what ships. That's how every docs platform ends up with "works on my machine" published sites.

This is the same trap that killed many "universal/isomorphic" frameworks. You're paying the complexity tax of two systems while getting neither's full benefits.

---

## 2. Mode A (Live Workspace) Is a Scalability & Reliability Nightmare

- **On-demand rendering on every request** with a full unified/remark/rehype pipeline (Shiki + Mermaid + whatever else). Even with caching you're going to eat CPU on cold hits or after reloads. A modestly large project with 200 markdown files + diagrams will feel sluggish.
- Chokidar watching *every project in the workspace* simultaneously. One massive monorepo or a user who clones 30 repos into `~/projects` and you're in fan-noise territory. File descriptor limits, CPU spikes on `git pull`, etc.
- Single long-lived Node process. Memory leaks in the markdown pipeline, unhandled watcher events, or a bad plugin = entire workspace dies. Good luck with systemd restart semantics when the process holds open file handles across the whole tree.
- In-memory search index: cute until it's 50k documents. Then you're in GC hell or OOM.

This is basically a poorly sandboxed personal wiki server. The security model ("just run it on tailnet") is wishful thinking.

---

## 3. Mode B (Static) Has Its Own Sharp Edges

- Build-time rendering in CI is fine until your docs repo hits a few thousand pages or heavy diagrams. GitHub Actions minutes burn fast, and cold caches on every PR make iteration painful.
- Pagefind is great for static search but has known limitations (no fuzzy matching as good as FlexSearch/Lunr, weaker on code blocks, client-side index size). You'll get complaints.
- Static + hydration SPA is the worst of both worlds: you pay for a heavy JS bundle *and* you have pre-rendered HTML. Many readers will never hydrate but you still ship the code. Classic Docusaurus tax.
- llms.txt + raw .md.txt is smart, but you're now maintaining two parallel content representations forever.

---

## 4. Configuration and Data Model Problems

- Two sources of truth for navigation (auto FS tree vs `config.nav`). This will cause constant user confusion and support burden.
- `.vibedocs.config.ts` in Mode B is powerful but now you have a TypeScript config that runs at build time vs whatever minimal config Mode A uses. Divergence incoming.
- No clear story for *components* or MDX. Right now it's "just markdown + plugins." The moment someone wants interactive examples, callouts with state, or versioned docs, the whole architecture buckles.

---

## 5. Operational and Ecosystem Reality Check

- **Distribution story** ("add vibedocs as dep") is painful. Consumers will hate pulling in a full Node toolchain + Vite + Hono just to publish docs. Compare to `next export`, VitePress, or Docusaurus — they made the static path trivial.
- Upload feature (even token-gated) in a docs tool is a footgun waiting for an incident. Especially when the same binary serves live workspaces.
- Zero mention of internationalization, versioning (v1/v2), A/B testing of docs, analytics, or paid hosting tier. You're building another indie docs tool in 2026 — the bar is high.

---

## 6. What You Actually Built (Brutally Honest)

You built a **very nice personal docs workbench** (Mode A) and then bolted on a **half-baked static exporter** (Mode B) that reuses as much code as possible to minimize work.

This is the opposite of how successful docs platforms evolved:

- VitePress / Docusaurus started static-first and added dev server.
- You started with a rich dev server and are trying to squeeze static out of it.

The shared renderer gives you short-term velocity but long-term technical debt.

---

## Harsh Recommendations (Take or Leave)

1. **Pick a primary mode.** Make static export the *source of truth* and make the workspace a thin viewer on top of a build cache. Or go full local-only and drop public static ambitions.
2. Introduce a proper intermediate representation (AST + metadata) that both modes consume, instead of passing `mode` flag everywhere.
3. Kill on-demand full rendering in Mode A. Cache aggressively (by content hash + config hash) or pre-render on FS change.
4. Consider separating the CLI/tooling (`vibedocs build`, `vibedocs dev`, `vibedocs preview`) from the runtime server. Right now it feels monolithic.
5. Study what Mintlify, Readme.io, and Docusaurus actually solved that you haven't (versioning, search quality, component ecosystem, contributor UX).

---

## Verdict

Clever hack for a solo/power-user workflow. Fragile foundation for anything beyond that. The shared code is seductive but masking deeper architectural tension between "rich live experience" and "clean static output."

You're at the point where continuing with the current dual-mode approach will make every new feature twice as painful. **Time to refactor or double down on one shape.**

---

## Status at time of review

- Sprint-vibedocs-pds slices merged: #46 (pure renderer), #47 (site config loader), #48 (inline siteConfig in /api/projects), #49 (build CLI scaffolding), #52 (sidebar site-nav mode).
- In flight at review time: #57 (GitHub-dep distribution).
- Still open: #50 (frontmatter + SEO), #51 (theming), #53 (llms.txt), #54 (sitemap), #55 (edit-on-GitHub), #56 (Pagefind), #58 (project switcher), #59 (capstone + workflow template).
- Known follow-ups already filed: #65 (asset-mirror filter), #66 (try/catch cleanup), #69 (CLAUDE.md `src/shared/` doc nudge), #70 (npm test split).

The review applies BEFORE the remaining 9 slices land. Reading it after the sprint completes will require re-evaluating which critiques are still load-bearing vs already mitigated.
