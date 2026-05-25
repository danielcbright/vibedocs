# VibeDocs as a publishable static-site engine — design spec

**Status:** draft (post-brainstorming, post-grill, pre-issues)
**Date:** 2026-05-25
**Forcing function:** [argus.io](https://argus.io) public OSS docs site (sister project under `~/claudebot/projects/argus/`, just shipped v0.1.0)
**Brainstorming source:** session transcript 2026-05-25; user-supplied gap analysis (17 items, 4 categories)
**Author:** coordinator agent, locked with user via /brainstorming + /grill-me
**PRD:** [issue #45](https://github.com/danielcbright/vibedocs/issues/45) (synthesised after brainstorming)

## Goal

Add the capability for VibeDocs — today a tailnet-bound markdown browser at `http://100.117.179.63:8080/` — to also emit per-project static sites suitable for public hosting on AWS S3 + CloudFront, themed to each project's identity, with first-class LLM-friendly endpoints. argus.io is the first customer; the design must generalise to any project under `~/claudebot/projects/*` that ships its own `.vibedocs.config.ts`.

## Non-goals (deferred to future sprints)

- Landing-page support (gap #5 — argus.io v1 ships with a hero-less docs-only site)
- Documentation versioning, e.g. v0.1.0 vs HEAD (gap #10)
- Analytics hooks (gap #13)
- Mermaid render bug on architecture.md (gap #14 — already tracked separately as issue #26)
- Publishing vibedocs as an npm package — first-sprint argus integration uses workspace path / local symlink
- `vibedocs deploy` orchestration — projects own their AWS wiring via plain GH Actions YAML (matches the brightopsinc.ai pattern)
- AWS bootstrap (S3 bucket creation, CloudFront distribution, ACM cert, Route53 DNS) — one-time manual or Terraform, outside vibedocs's surface

## In scope (12 of 17 original gaps)

| Gap | Category | Status |
|---|---|---|
| 1 | Static-export mode | In scope |
| 2 | Public deploy story (AWS pattern) | In scope (via brightopsinc-style GH Actions YAML, no `vibedocs deploy` subcommand) |
| 3 | Multi-tenant routing | In scope (per-project config + bucket-per-site) |
| 4 | Per-deployment theming | In scope (tokens + CSS escape hatch) |
| 6 | `/llms.txt` support | In scope (llmstxt.org compliant) |
| 7 | Plain-text raw endpoints (`.md` → `.md.txt`) | In scope |
| 8 | GitHub Actions integration | In scope (workflow template) |
| 9 | "Build once" CLI | In scope (`vibedocs build`) |
| 11 | sitemap.xml / robots.txt | In scope |
| 12 | SEO meta per page | In scope (frontmatter + config defaults) |
| 15 | Edit-on-GitHub link per page | In scope (config-driven) |
| 16 | Code-block copy button | In scope (verify existing, polish if needed) |
| 17 | Pagefind-style static search | In scope (post-build index step) |

## Design

### 1. Architecture — one renderer, two modes

A **pure renderer module** (`src/render.ts`, new) is extracted from today's Hono route handlers. Its public surface is:

```ts
// pure: no HTTP, no FS-mutation, no chokidar
export async function renderProject(
  projectPath: string,
  siteConfig: SiteConfig | null,  // null = generic browser mode
): Promise<{
  pages: HtmlPage[]
  assets: AssetRef[]
  llmsTxt: string
  llmsFullTxt: string | null  // null when siteConfig is null
  sitemap: string | null      // null when siteConfig is null
  robots: string | null       // null when siteConfig is null
}>
```

Two consumers:

**Runtime mode (Hono server, today)** — keeps serving on port 8080 to the tailnet. The renderer is invoked per request. When the active project has a `.vibedocs.config.ts`, the renderer applies that site's theme + nav + SEO; otherwise generic browser chrome.

**Build mode (`vibedocs build` CLI, new)** — invoked once per project. Walks the project, calls the pure renderer with the project's config, writes the output to `dist/`: HTML/CSS/JS/assets/llms.txt/llms-full.txt/sitemap.xml/robots.txt. The output is S3-ready static files; no server required at runtime.

The same render pipeline produces identical HTML for both modes — site preview in the live tailnet vibedocs IS what argus.io will look like once built and deployed.

### 2. Per-project site config (`<project>/.vibedocs.config.ts`)

Config lives in the project being documented (argus owns argus.io's identity, brightopsinc owns its docs site if it adopts vibedocs later). TypeScript so projects get autocomplete + type errors from the `defineSite` helper that ships with vibedocs.

```ts
import { defineSite } from 'vibedocs/config'

export default defineSite({
  name: 'argus',
  domain: 'argus.io',
  description: 'Drop-in observability for AI agents',

  theme: {
    tokens: {
      primary: '#39ff14',           // phosphor green
      background: '#0a0e0a',
      fontDisplay: 'Press Start 2P',
      fontBody: 'VT323',
    },
    logo: './brand/logo.svg',
    favicon: './brand/favicon.ico',
    css: './brand/extras.css',      // escape hatch (optional); appended to bundle
  },

  nav: {                            // sidebar override; missing = use file discovery
    sections: [
      { label: 'Getting Started', items: ['README.md', 'docs/install.md'] },
      { label: 'Reference', items: ['docs/api.md', 'docs/cli.md'] },
    ],
  },

  llms: {
    summary: 'Argus is an OpenTelemetry-native observability layer for AI agents…',
    keyDocs: ['README.md', 'docs/quickstart.md', 'docs/api.md'],
  },

  seo: {
    ogImage: './brand/og.png',
    twitterHandle: '@arguslabs',
  },

  editOnGitHub: {
    repo: 'arguslabs/argus',
    branch: 'main',
    rootPath: '',                   // path within repo where docs live; '' = project root
  },
})
```

`defineSite` is a tiny type helper exported from vibedocs. For the first sprint, argus consumes it via TypeScript path mapping in `tsconfig.json` (no npm publish); a future sprint may extract `@vibedocs/config` once a second customer exists.

The config is loaded:
- At **build start** by the CLI
- At **first request per project** by the live server (cached in memory; re-loaded on file change via the existing chokidar watcher)

Markdown **frontmatter** is parsed at render time via `gray-matter` (new dep). Page-level SEO fields (`title:`, `description:`, `og_image:`) override the site-level defaults from the config. The existing rendering pipeline gains a gray-matter step before remark.

### 3. CLI shape (`vibedocs build`)

Build-only. No `vibedocs deploy`. Matches the brightopsinc.ai pattern: vibedocs emits a static `dist/`, the project's CI does the AWS work in plain workflow YAML.

```bash
vibedocs build --project argus --out ./dist
vibedocs build --project argus --out ./dist --base-url https://argus.io
vibedocs build --project argus --serve            # local static server on dist/, for sanity-check
vibedocs build --project argus --serve --port 5000
```

`--base-url` controls canonical URLs in `<link rel=canonical>`, `sitemap.xml`, og:url, and any other absolute-URL emission. Defaults to `https://<config.domain>`.

`--serve` runs a tiny static server (sirv-cli or equivalent) on the built dist. Useful before pushing.

### 4. GitHub Actions workflow (project-side template)

argus's `.github/workflows/release.yml` mirrors brightopsinc.ai's deploy.yml exactly, swapping bucket name + distribution ID + build env vars:

```yaml
- run: npx vibedocs build --project argus --out ./dist
- uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: us-east-2
- run: aws s3 sync ./dist s3://argus.io --delete --region us-east-2
- run: aws cloudfront create-invalidation --distribution-id ${{ secrets.ARGUS_CF_ID }} --paths "/*"
```

Vibedocs ships an example workflow template at `examples/release.yml.template` that projects can copy + adapt.

### 5. Theming (tokens + CSS escape hatch)

Tokens declared in config become CSS custom properties applied to `:root` via a single `<style>` injection in the rendered HTML head:

```css
:root {
  --color-primary: #39ff14;
  --color-background: #0a0e0a;
  --font-display: 'Press Start 2P', system-ui, sans-serif;
  --font-body: 'VT323', monospace;
}
```

Vibedocs's own components (already using `var(--color-*)` via shadcn) inherit the theme automatically. The defaults in `frontend/src/index.css` remain in place so non-configured projects render with vibedocs's default theme.

Logo, favicon, og-image referenced by relative path in config are copied into `dist/` at build (and served from `/api/file/...` in live mode). `theme.css` if present is concatenated to the main stylesheet bundle.

Fonts are referenced by name (the config doesn't ship the font files). Projects with custom fonts (argus uses Press Start 2P + VT323) include the `@font-face` declarations in their `theme.css` escape hatch.

### 6. LLM-friendly endpoints (llmstxt.org compliant)

At build time, `dist/llms.txt` is emitted following the llmstxt.org convention:

```
# Argus

> Drop-in observability for AI agents. OpenTelemetry-native, agent-aware tracing.

## Key documentation

- [Quickstart](https://argus.io/docs/quickstart): Install + first trace in 5 minutes
- [API Reference](https://argus.io/docs/api): Full HTTP + SDK surface
- [README](https://argus.io/README): Project overview

## Full docs

- [docs/install.md](https://argus.io/docs/install.md): Install
- ... (auto-listed from discovery)
```

Built from `config.llms.summary` + `config.llms.keyDocs` (curated section) + the rest of the discovered doc set (auto-listed section).

Every `.md` is also emitted as `.md.txt` (raw markdown, no HTML wrapping). `docs/install.md` is reachable at both `https://argus.io/docs/install` (rendered HTML) and `https://argus.io/docs/install.md.txt` (raw markdown).

`robots.txt` is permissive (`User-agent: * \n Allow: /`) — humans + crawlers + AI agents all welcome.

(Future sprint: `llms-full.txt` concatenated feed, per-doc `.json` metadata. Out of scope for this sprint.)

### 7. Live preview mode

When the live tailnet vibedocs renders a project with `.vibedocs.config.ts`, it detects the config on the fly and applies that site's theme + nav + SEO + edit-on-GitHub. The global vibedocs hamburger / project switcher stays accessible (you can still navigate to a different project), but the rendered doc's chrome becomes the site's chrome.

Result: writing `docs/quickstart.md` in argus, the operator sees it at `#argus/docs/quickstart` themed in argus phosphor with argus nav — what argus.io will look like once deployed. No build step in the inner iteration loop.

### 8. SEO + sitemap.xml + edit-on-GitHub

- **Frontmatter per page** overrides site-level defaults: `title:`, `description:`, `og_image:`, `twitter_card:`, `noindex:`.
- **`<head>` tags** rendered per page include canonical URL, og:title, og:description, og:image, og:url, twitter:card, twitter:site.
- **`sitemap.xml`** emitted at build from the discovered page list + config `domain`. Excluded by frontmatter `noindex: true`.
- **Edit on GitHub** link rendered in the page footer; URL computed from `config.editOnGitHub` + the doc's path-from-project-root. Format: `https://github.com/{repo}/edit/{branch}/{rootPath}/{docPath}`.

### 9. Static search (Pagefind)

Pagefind is invoked as a post-build step: `pagefind --site ./dist`. It indexes the built HTML in place and emits a `_pagefind/` directory.

The frontend's existing search UI (CmdK palette) gets a small abstraction in `frontend/src/hooks/use-search.ts`:
- **Live mode** uses the in-memory IndexStore against the Hono backend (today's behaviour).
- **Built site** uses Pagefind's browser API against the static `_pagefind/` index.

Switching between the two is detected from a runtime flag injected at build (`window.__VIBEDOCS_STATIC = true`).

### 10. Multi-tenant routing

At **build time**, `vibedocs build --project argus` produces one static site per invocation. Multi-tenancy is solved at the infra layer: one S3 bucket per site, one CloudFront distribution per site, one Route53 record per site.

At **runtime** (live tailnet vibedocs), the existing project switcher in the sidebar handles tenancy. Each project's `.vibedocs.config.ts` is detected lazily on first navigation to that project; live preview mode kicks in if present.

No new routing primitives needed beyond what the current sidebar already provides.

## Architecture diagram

```
                   ┌──────────────────────────────────────┐
                   │  src/render.ts (PURE)                │
                   │  renderProject(path, config) →       │
                   │    { pages, assets, llmsTxt, ...}    │
                   └──────────────────────────────────────┘
                              ▲                  ▲
                              │                  │
        ┌─────────────────────┘                  └─────────────────────┐
        │                                                                │
┌───────────────────┐                                       ┌────────────────────────┐
│ src/server.ts     │                                       │ src/cli/build.ts (new) │
│ (Hono, runtime)   │                                       │ vibedocs build         │
│                   │                                       │                        │
│ live tailnet:     │                                       │ one-shot:              │
│ 8080, all         │                                       │ - walk project tree    │
│ projects, switch  │                                       │ - render each page     │
│ to site preview   │                                       │ - emit dist/           │
│ when config       │                                       │ - run pagefind        │
│ present           │                                       │                        │
└───────────────────┘                                       └────────────────────────┘
        │                                                                │
        ▼                                                                ▼
   tailnet users                                              S3 bucket + CloudFront
                                                              (per-project GH Actions YAML)
```

## File changes (sprint 1 surface)

New:
- `src/render.ts` — pure renderer (extracted from current handlers)
- `src/cli/build.ts` — build CLI entrypoint
- `src/cli/index.ts` — `vibedocs` command dispatcher
- `src/site-config.ts` — config loader + defineSite type helper
- `src/llms-txt.ts` — llms.txt generator
- `src/sitemap.ts` — sitemap.xml + robots.txt generator
- `examples/release.yml.template` — GH Actions workflow template
- `examples/.vibedocs.config.example.ts` — config template for projects to copy
- New `tests/` files for each new module

Modified:
- `src/server.ts` — call `renderProject` instead of inline rendering; detect per-project config + apply site preview mode
- `src/discovery.ts` — already does most of what's needed; minor changes for nav override
- `src/markdown.ts` — add gray-matter step before remark
- `frontend/src/hooks/use-search.ts` — Pagefind fallback for built-site mode
- `frontend/src/index.css` — token defaults; site overrides via `:root` injection
- `package.json` — add deps: `gray-matter`, `pagefind`, `sirv-cli` (for `--serve`)
- `bin/vibedocs` (new) — shebang script that runs `src/cli/index.ts` via tsx
- `CLAUDE.md` — document the build mode + site preview mode

## Risk + mitigation

| Risk | Mitigation |
|---|---|
| Pure-renderer extraction breaks live server | Issue-by-issue, with full vitest coverage of `renderProject` before swapping the handler |
| Theme tokens collide with vibedocs's own UI vars | Namespace site tokens: `--vd-site-primary` instead of `--color-primary`; site tokens apply only inside `.vd-site-preview` scope |
| Live preview is too slow per request (file IO) | Cache `SiteConfig` per-project on first load; invalidate on chokidar event for `.vibedocs.config.ts` |
| Pagefind's index in `_pagefind/` collides with vibedocs's own assets | `_pagefind/` is at the dist root; vibedocs doesn't write there at build |
| `gray-matter` adds parsing time to every doc render | gray-matter is fast (microseconds per doc); acceptable. Cache parsed result alongside the HTML output |
| argus uses fonts vibedocs doesn't bundle | Project ships `@font-face` in its `theme.css` escape hatch; vibedocs's job is just to apply the var |

## Open questions resolved during brainstorming

1. **Stay vibedocs or pivot to Astro Starlight?** → Stay vibedocs. Honest trade-off acknowledged: Starlight closes ~80% of the 17 gaps out of the box, vibedocs requires building them. Differentiator that justifies the cost: vibedocs is YOURS, owns its identity, ships llms.txt as a first-class feature, lives in the same ecosystem as argus.
2. **Build engine shape: in-process / crawl / pure renderer / separate package?** → **Pure renderer extracted, shared by runtime + build**. Cleanest separation, sets up incremental rebuild later.
3. **Site config location?** → **In the project being documented** (`<project>/.vibedocs.config.ts`). Projects own their identity; vibedocs stays generic.
4. **Theming model?** → **Tokens + CSS escape hatch**. Declarative for the 90% case; `theme.css` for the rare custom case (argus's multi-eye mascot animation).
5. **LLM endpoint depth?** → **Standard llmstxt.org + raw .md.txt routes**. Defer `llms-full.txt` + per-doc JSON metadata to a future sprint.
6. **Deploy CLI scope?** → **Build-only**. brightopsinc.ai pattern: plain GH Actions YAML, no `vibedocs deploy` subcommand.
7. **Live preview applies the site's theme?** → **Yes — site preview mode**. Detected automatically from per-project config. Global hamburger / project switcher stays accessible; rendered doc's chrome becomes the site's chrome.
8. **Frontmatter parsing?** → **Yes — add gray-matter**.
9. **`defineSite` packaging?** → **Hardcode in argus's tsconfig for sprint 1; defer publishing `@vibedocs/config` to second-customer pressure**.

## Decisions resolved during /grill-me

The six brainstorming locks left several architectural cascades unresolved. /grill-me walked the dependency tree and pinned them.

### Grilled-and-locked

10. **Static-export render shape?** → **Hybrid**. Live mode keeps the SPA + Hono API (fast iteration). Build mode pre-renders every route to its own HTML file (`/docs/install/index.html`). Both consume the same `renderProject` core.
11. **How much JavaScript ships in the static dist?** → **Content + lazy chrome JS**. Pre-rendered HTML contains the article + plain-link nav baked in (works without JS — readable, crawlable, SEO-friendly, agent-friendly). React bundle ships and mounts post-load to add chrome interactivity (sidebar, search palette, theme toggle, mobile drawer). **No hydration** — React renders chrome fresh against a mount target separate from the static article, avoiding hydration-mismatch failure modes.
12. **URL shape in built `dist/`?** → **Clean URLs**. `docs/install.md` → `/docs/install/index.html`, browser shows `argus.io/docs/install/`. Internal markdown `.md` links rewritten to clean URLs at build time. Live tailnet keeps hash routes (`#argus/docs/install.md`). The renderer is mode-aware about link rewriting.
13. **How does argus get the `vibedocs` build binary?** → **GitHub dep in package.json**. argus's `package.json` gets `"vibedocs": "github:danielcbright/vibedocs"`. `npm install` clones+builds vibedocs into argus/node_modules. CI runs `npx vibedocs build --project argus --out ./dist`. Same path local + CI. **Implication (added to risk/mitigation):** vibedocs needs a `prepare` script that compiles `src/cli/**/*.ts` → `dist-cli/` and a `bin.vibedocs` field pointing at the compiled entry. Today everything runs via `tsx`; this is new tooling work.
14. **How does the live SPA learn per-project site config?** → **Inline in `/api/projects`**. The existing `/api/projects` response gets a `siteConfig: SiteConfig | null` field per project. One round trip serves tree + config. Server loads and caches configs on first hit; chokidar invalidates the cache when a project's `.vibedocs.config.ts` changes.
15. **Live preview chrome fidelity?** → **Built-site faithful + 'switch project' affordance**. Live preview renders as close to the built site as possible: argus's `config.nav` drives the sidebar (not the file tree), argus theme applied throughout, doc footer has edit-on-GitHub, etc. The 'switch to another project' affordance is bolted on as a small dropdown in the top-right corner (live only). WYSIWYG between authoring and prod. The `AppSidebar` component grows a "site nav from config" rendering mode used by BOTH live preview and build.

### Recommended-and-locked (no pushback from user)

16. **Token namespace + shadcn collision?** → Site tokens override shadcn vars inside a `.vd-site-preview` scope: `.vd-site-preview { --color-foreground: var(--vd-site-foreground); --color-background: var(--vd-site-background); ... }`. Existing components inside the scope automatically pick up the site theme. The small switcher widget lives outside the scope and stays vibedocs-themed.
17. **Asset placement in dist?** → Mirror source structure. `docs/diagram.png` → `/dist/docs/diagram.png`. Renderer computes relative `<img src="../diagram.png">` paths from the page's URL (e.g. `/docs/install/`) to the asset's URL. No flattening, no per-doc duplication.
18. **Frontmatter `title:` semantics?** → Sets `<title>` and og:title only. The H1 in the body stays whatever the author wrote. No automatic H1 generation from frontmatter (predictable; avoids the surprise of two titles or a missing one).
19. **Internal markdown link rewriting?** → Only in-project `.md` links are rewritten. Cross-project links are the author's responsibility (write absolute URLs if you really need a link from argus.io to brightopsinc.ai).
20. **Pre-render HTML template?** → Hardcoded template inside the build CLI, composed from frontmatter + config. Per-customer template override is out of scope for sprint 1; revisit if a customer asks.
21. **CSP for static dist?** → Same CSP as live, already locked-in by security #34. Built dist's `index.html` template carries the same `<meta http-equiv="Content-Security-Policy">` directive. Pagefind's chunks are same-origin and already permitted by `script-src 'self'`.

## Risks and follow-ups surfaced during /grill-me

(Append to the Risk + mitigation table above; pulled out here so they don't get lost in slicing.)

| Risk | Mitigation |
|---|---|
| GitHub-dep distribution requires `prepare` script + compiled CLI — non-trivial new tooling | Land as its own sprint slice with explicit acceptance criteria: vibedocs's `prepare` script produces `dist-cli/` from `src/cli/**/*.ts`; `bin.vibedocs` resolves cleanly; a third-party project can `npm install github:danielcbright/vibedocs` and immediately run `npx vibedocs build` |
| 'Switch project' corner dropdown is new UI for live preview | Small UX surface area: top-right corner, dropdown with project names, click navigates to `#<project>/...`. Visible only when live (omitted from build). Deserves its own slice (small) |
| Asset URL rewriting is mode-aware (live `/api/file/...` vs built relative paths to mirrored structure) | Renderer takes a `mode: 'live' | 'build'` (or equivalent) parameter and computes asset URLs accordingly. Heavy test coverage required, especially for nested directories, images in subfolders, and edge cases like images referenced from a doc in a subfolder pointing UP to an asset higher in the tree |
| Built-site-faithful preview means `AppSidebar` grows a second rendering mode | Site-nav mode renders config-declared sections instead of the file tree. The file-tree mode stays as-is for projects without `.vibedocs.config.ts`. The two modes share the same wrapper component but branch internally |
| Live config is fetched via `/api/projects` — frontend now blocks on a richer response | Loader keeps current shape compatibility (`siteConfig` is optional, defaults to null). Frontend renders the SPA shell immediately and only switches to site-preview mode when the augmented payload arrives |

## What success looks like

End of sprint:
- argus.io is live, served from S3 + CloudFront with HTTPS via ACM, DNS via Route53
- Pushing a doc to `arguslabs/argus@main` triggers a GH Actions release.yml that rebuilds + redeploys argus.io within 5 minutes
- The argus.io homepage and every doc page is themed in argus phosphor identity (Press Start 2P + VT323 + multi-eye mascot)
- `https://argus.io/llms.txt` serves a valid llmstxt.org index
- `https://argus.io/docs/quickstart.md.txt` serves raw markdown
- `https://argus.io/sitemap.xml` serves a complete sitemap
- Every doc page has correct `<head>` SEO + an "Edit on GitHub" footer link
- Static search via Pagefind works on the built site
- Live tailnet vibedocs at `http://100.117.179.63:8080/#argus/...` previews docs themed in argus identity (no build step required for the inner iteration loop)
- Vibedocs's existing "browse all projects" mode at the tailnet URL continues to work for projects without `.vibedocs.config.ts`

## Next step

Per the skill chain (brainstorming → grill-me → to-issues): brainstorming is done (the original 9 open questions), the grill is done (an additional 12 cascading decisions, now locked), and this spec is the input to `/to-issues`. The proposed slicing plan (under sign-off before issues land) is:

1. Pure renderer extraction (`src/render.ts`) — foundation; all other slices depend on this
2. Site config loader + `defineSite` type helper (`src/site-config.ts`)
3. `/api/projects` augmentation — inline siteConfig per project
4. Build CLI scaffolding (`vibedocs build` → emits per-route HTML, no theme/SEO/llms.txt yet)
5. Frontmatter parsing (gray-matter step) + per-page `<head>` SEO meta
6. Per-site theming (token CSS vars + scoped override + theme.css escape hatch)
7. AppSidebar "site nav from config" rendering mode (live + build)
8. llms.txt + raw .md.txt generators
9. sitemap.xml + robots.txt generators
10. Edit-on-GitHub footer link
11. Pagefind integration (post-build + frontend search hook abstraction)
12. GitHub-dep distribution: `prepare` script + compiled CLI + `bin` field
13. Switch-project corner widget for live preview
14. GH Actions workflow template + argus.io integration (the capstone)

Each slice is intended to be a vertical tracer-bullet (touches the necessary layers end-to-end, demoable on its own). The order is roughly dependency-driven: slice 1 is the foundation; slices 2-13 layer features; slice 14 puts argus.io live as the integration test.
