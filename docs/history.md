# VibeDocs development history

## Why this doc exists

VibeDocs reached v0.2.0 over roughly 200 commits and ~44 merged pull requests of
detailed, granular development history. Before the public announce, that history
was deliberately collapsed (squashed) to give the repository a clean starting
point — partly for tidiness, partly because the pre-squash commits embedded PII
that a force-push couldn't fully retire without also rewriting the narrative.

This document is the substitute for that lost detail. It is a curated narrative,
not a commit dump: it records the milestones, the design decisions, and the
transferable lessons so a newcomer can understand the project's arc in a couple
of minutes. The living documents it links to — [CONTEXT.md](../CONTEXT.md),
[ADR-0001](adr/0001-appstate-shape.md), [README.md](../README.md), and
[CLAUDE.md](../CLAUDE.md) — survive the squash and remain the source of truth for
*how things are now*. This doc is the source of truth for *how we got here*.

## The arc at a glance

VibeDocs started as a single-purpose "docs-browser" — a Hono server that
discovered markdown across a workspace and rendered it in a React UI. It grew
through five overlapping phases:

1. **Foundation & mobile** — initial server, file upload, React frontend,
   self-hosted Mermaid, mobile-first responsive work.
2. **Security hardening** — an adversarial security pass that surfaced XSS, CSWSH,
   unauthenticated upload, and path-traversal classes of bug, each fixed with a
   typed, tested perimeter.
3. **Static-site engine** — the "publishable static site" sprint that split the
   renderer into one engine with two delivery modes (live app + `vibedocs build`).
4. **Architecture audit** — two rounds of disciplined refactoring that collapsed
   `server.ts` from a 331-LOC tangle to a 77-LOC composition root.
5. **Launch prep** — PII purge, security tooling (gitleaks, Dependabot), a demo
   workspace, and PWA installability.

## Phase 1 — Foundation, rendering, and mobile

The first commit shipped the workspace docs-browser. Early work established the
core capabilities the app still has: project/file discovery, on-demand markdown
rendering (unified/remark/rehype + Shiki), full-text search, a typed WebSocket
live-reload protocol (#2), and file upload (#1).

A cluster of correctness and quality issues followed:

- **Typed error taxonomy** (#6) replaced raw `fs` error leakage with a
  `VibedocsError` type and a single HTTP translation point.
- **Versioned search index** (#4) and a **`useRawDocument` hook extraction** (#3)
  cleaned up state ownership.
- **Mermaid** got self-hosted with a production-build chunk-shape guard (#21,
  #23, #24) after a regression where the prod bundle dropped Mermaid's default
  export. `tests/mermaid-bundle.test.ts` exists specifically to catch that class
  of regression.

A dedicated mobile pass made the app usable on phones: hamburger + sheet drawer
(#13), TOC as a bottom sheet (#14), 44×44 tap targets on every icon-only control
(#15), and scroll hints on overflowing code blocks and tables (#16).

## Phase 2 — Security hardening

An adversarial review treated the app as network-exposed and filed a batch of
labelled security issues. Each was fixed as a vertical slice with tests:

| Issue | Class | Fix |
|---|---|---|
| #33 | XSS (HIGH) | Sanitize the markdown render pipeline; no raw HTML from untrusted input |
| #34 | Stored XSS (HIGH) | CSP + `nosniff` + `Content-Disposition` on `/api/file`; extension allowlist |
| #35 | CSWSH (HIGH) | WebSocket Origin allowlist — blocks cross-site WebSocket hijacking |
| #36 | Unauth upload (MED) | Env-token auth + read-only mode gate on `POST /api/upload/*` |
| #37 | Path leak (MED) | PathResolver rejects dotfiles and excluded-dir components |
| #38 | Info leak (LOW) | WS broadcasts project-relative paths, not absolute filesystem paths |

The structural outcome was a **`PathResolver`** (#7) returning a branded
`SafePath` type that downstream filesystem calls require, and an **upload auth
pipeline** with constant-time token comparison and an explicit gate ordering
(read-only → token-configured → authorized → extension → size). That gate order
is the security ordering, and structural tests enforce it.

## Phase 3 — The static-site engine sprint

The "publishable static site" sprint (`sprint-vibedocs-pds`, issues #46–#57) set
out to make VibeDocs produce a static site from the same content it serves live —
**one renderer, two delivery modes**, the framing that now anchors
[CONTEXT.md](../CONTEXT.md).

Slices shipped from this sprint and its `distribution-cleanup` follow-up:

- **Pure renderer extraction** (#46) — pulled rendering out of the server so it
  could run headless in a build.
- **Site-config loader + `defineSite` helper** (#47) and **inlining `siteConfig`
  in `/api/projects`** (#48).
- **Build CLI scaffolding** (#49) — `vibedocs build → dist/`.
- **Config-driven sidebar nav** (#52) and **sitemap.xml / robots.txt
  generators** (#54).
- **GitHub-dep distribution** (#57) — a compiled CLI + `bin` field so the project
  installs via `npm install -g github:danielcbright/vibedocs`.

The `distribution-cleanup` follow-up tightened the package shape: a
renderer-owned referenced-asset set (#74) so the build mirrors only assets the
docs actually reference, a self-contained `dist-cli/` package (#75), and a
**hydration policy adapter** (#76) — the `full`/`minimal` split documented in
CLAUDE.md, where `minimal` ships ~500 KB less JS for read-mostly public sites.

Of the 14 originally-scoped slices, the renderer, config loader, build CLI,
nav-rendering, distribution, and asset-set work landed; the remainder (a static
Pagefind search integration, server-side Mermaid, and related niceties) stayed
queued behind the launch.

## Phase 4 — The architecture audit (and the premise-check pattern)

The audit is the most transferable part of the project's history. An
`improve-codebase-architecture` pass surfaced **15 candidate refactors**
(filed as issues #82–#95 plus follow-ups). Crucially, they were *not* all
implemented:

- **~7 shipped** as real structural improvements — single source of truth for
  excluded paths (#82) and markdown file-type detection (#83), route
  path-extraction middleware (#84), markdown-processor factory (#85), upload
  validation pipeline (#86), frontend API-client extraction (#87), and the
  reference-collector seam (#94).
- **Several were closed via premise check** — the audit framed them as "extract
  X," but a sibling extraction had *already* produced X as a side effect. Filing
  an issue is not a commitment to implement it; each candidate was re-grilled
  against the current tree before work started.
- **A few were closed as pure test additions** — no production code changed;
  they hardened existing seams (sanitize-schema perimeter tests #89, WebSocket
  reconnection tests #91, direct url-rewriter tests #100).

> **The premise-check pattern is the lesson:** on a multi-slice audit, the tree
> moves under you. An issue written on Monday may be satisfied by Wednesday's
> unrelated refactor. *Grill the premise before implementing* rather than
> dutifully working a stale ticket. This is recorded in project memory as the
> "audit premise-check pattern."

A **second audit round** (#108) added test coverage at the production seams the
first round created — adapters, boot, plugins, static build, and CLI — so the new
structure wouldn't silently rot.

### The AppState design-it-twice

The audit's hardest call was issue #92: `server.ts` tangled eight concerns at
module scope with no testable seam. Rather than improvise, the work ran
`architecture-design-it-twice` and produced **four parallel designs**:

- **A** — minimal `Request → Response` interface (rejected: smuggled path
  resolvers into the factory closure).
- **B** — event-grammar interface with a discriminated union (rejected:
  operationally fragile, evolvability VibeDocs doesn't need).
- **C** — behavioural-verb interface (`listProjects`, `renderPage`, `search`,
  `broadcast`, `uploadAuth`).
- **D** — full ports-and-adapters with 8 typed ports (rejected as a whole).

The winner was a **hybrid: Design C as the base, with two ports grafted from
Design D** — `FsEventSource` (Chokidar in prod, in-memory in test) and
`ClientChannel` (`ws` in prod, in-memory in test) for the two genuinely external
dependencies. The other six ports were rejected as ceremony, since their wrapped
modules were already factory-shaped. The governing principle: *"one adapter means
a hypothetical seam; two adapters means a real one."* The full reasoning lives in
[ADR-0001](adr/0001-appstate-shape.md).

The payoff: **`server.ts` collapsed from 331 LOC to 77 LOC** of composition-root
wiring, and AppState became constructable in tests with no HTTP — drive
filesystem events synchronously, assert on the recorded `ClientChannel.sent[]`.

## Phase 5 — Launch preparation

### The PII purge

Before the public announce, four passes scrubbed personally-identifying and
environment-specific data out of the tracked files and history: **workspace
filesystem paths, tailnet hostnames, and real internal project names** were
replaced with neutral placeholders and a fictional demo workspace. The mechanism
was `git filter-repo` plus a force-push to rewrite the affected history, done
*before* announce so the public repo never carried the leaked data. The
final tracked-file redaction is preserved as a single commit
(`security: redact PII from tracked files`).

### Security tooling

v0.2.0 ships a defence-in-depth pipeline so PII and secrets can't re-enter:

- **gitleaks** as both a pre-commit hook and a CI scan (`security: add gitleaks
  pre-commit + CI scan, dependabot config`).
- **Dependabot** for dependency-update PRs.
- **`npm audit fix`** swept the known-vulnerable transitive deps (picomatch, ws,
  vite, rollup).
- GitHub-native scanning enabled on the repo.

### Demo, PWA, and polish

A fictional **Cirrus Weather** demo workspace (#112) lets a newcomer run
`vibedocs --root ./demo` with no markdown of their own. Late issues made both the
live app (#142) and static builds (#143) **installable, offline-capable PWAs** on
iOS and Android, and a discoverability hint (#109) surfaces the
preview-as-static-site affordance in the breadcrumb.

## Metrics

These reflect the state at v0.2.0. Pre-squash commit and PR counts are
approximate by nature — the detailed history they describe no longer exists in
the tree.

| Metric | Value |
|---|---|
| Commits (pre-squash, approx.) | ~205 |
| Merged pull requests | ~44 |
| Closed issues | ~60 |
| Test cases | ~449 across 58 test files |
| `server.ts` LOC | 331 → 77 |
| Architecture-audit candidates | 15 surfaced (≈7 shipped, rest closed via premise-check or as test-only) |
| Static-site sprint slices | 6 of 14 shipped, 8 queued |
| PII purge passes | 4 |

## Surviving canonical docs

This history is narrative; the following documents are authoritative for the
current system and survive the squash:

- **[CONTEXT.md](../CONTEXT.md)** — domain language and the "one renderer, two
  delivery modes" framing.
- **[docs/adr/0001-appstate-shape.md](adr/0001-appstate-shape.md)** — the AppState
  design-it-twice decision in full.
- **[README.md](../README.md)** — what VibeDocs is and how to run it.
- **[CLAUDE.md](../CLAUDE.md)** — operational guidance, configuration, and the
  upload/hydration policy tables.
