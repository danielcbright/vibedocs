# Architecture audit session — 2026-05-30

Wrap-up of the multi-day architecture audit sprint on vibedocs. This doc captures the outcome, the meta-pattern that emerged (premise check), the single design-it-twice run, the workflow tooling that was built mid-sprint, and the headline code metrics.

## Headline outcome

14 audit issues entered the queue. At session close:

- **8 shipped** as merged refactor PRs
- **5 closed via premise check** — the value the issue proposed was already delivered by an earlier slice's side-effects (see below)
- **1 closed as test additions** — the seam existed but lacked direct coverage (#100, url-rewriter direct unit tests)
- **0 left open**

Zero production regressions. Zero visible behavior changes. The user-facing app at vibedocs.tailc9eea3.ts.net behaves identically; everything that moved was internal architecture.

## The premise-check pattern

This is the most important takeaway from the sprint, and the reason it's getting its own section.

### Definition

> An audit slice framed as **"extract X"** or **"make X layered"** can be a candidate for premise check if a prior structural extraction or SSOT consolidation may have already delivered the value.

### The signature

The signature is:

> **The deletion test passes structurally, but the seam already exists via a different module.**

The "deletion test" is the architecture-improvement heuristic: *if I deleted this module, what would break, and how would I know?* When that test passes — i.e. there IS a seam, things WOULD break in legible ways — but the existing seam is provided by a sibling module that landed earlier in the same sprint, the proposed extraction is **redundant**. Implementing it would add a layer of indirection without earning leverage.

### How to recognize it

A slice is a premise-check candidate when **all** of the following hold:

1. The slice was identified by the audit BEFORE several other slices landed.
2. One of those landed slices was a structural extraction (factory, SSOT consolidation, port boundary).
3. The audit text says "extract X into its own module" or "make X layered" — i.e. it proposes a new seam.
4. After the earlier landings, grepping for the proposed seam's call sites finds them clustered at a single module boundary that *did not exist when the audit ran*.

When that pattern fires: **grill the slice before implementing it**. Use `/grill-with-docs` against CONTEXT.md + the merged PR that may have absorbed the value. If the grill confirms the seam exists, close with a "premise check" comment that names the absorbing module.

### Why this matters going forward

Architecture audits are **point-in-time snapshots**. They photograph the codebase at hour zero. By hour 30, half the photographs are stale because earlier slices reshaped the seams. **Re-checking premises before implementing each slice is now mandatory** for any multi-week audit sprint. Cheaper to grill than to write a refactor whose target already exists.

## The 5 premise closes

Each entry: issue number, slice title, absorbing module/PR, one-sentence rationale.

### #90 — AssetRewriter module (HITL — design-it-twice)
**Absorbed by:** [#97] Markdown processor factory.
The url-rewriter logic became cleanly testable as a pure function once the markdown processor factory landed — extracting it into its own module-with-ports was redundant. Closed; covered by #100 (direct unit tests on the pure function).

### #93 — PathResolver pluggable validation layers (HITL — design-it-twice)
**Absorbed by:** existing `src/path-resolver.ts` SSOT + the two-instance pattern (`docResolver`, `assetResolver`).
The proposed layered-validator extraction would have re-wrapped logic that PathResolver already encapsulates as a single source of truth, with each validation step legible from comment labels in the file. The seam exists; making it pluggable was speculative.

### #94 — Reference-collector seam extraction
**Absorbed by:** [#97] Markdown processor factory.
After the factory landed, the collector's interface IS the module boundary — `processMarkdownWithReferences(...)` returns `{ html, referencedAssets }`. There is nothing left to extract; the collector is the seam.

### #88 — Minor pass-through cleanups (batched)
**Absorbed by:** [#92] AppState orchestration module, and reversed by audit-era prior cleanups.
The proposed "minor cleanups" were misread by the audit — some were already gone (deleted in a pre-audit promotion), and the rest were reversed in spirit by the AppState extraction in #92. Closed with a one-line "covered by #92" note.

### #95 — Site-config watcher decoupling (HITL)
**Absorbed by:** [#92] AppState orchestration module via the `FsEventSource` port.
The watcher decoupling the audit proposed IS the `FsEventSource` port grafted from Design D into the AppState shape. Once AppState landed, the typed subscriber interface — the deliverable of this slice — already existed. The premise check confirmed it; close with a pointer to ADR-0001.

## The single design-it-twice run

One slice survived premise check and warranted a real design-it-twice pass: **#92 AppState orchestration module**.

The workflow:

1. `architecture-design-it-twice` spawned 4 parallel sub-agents with radically different constraints (minimal, flexible, common-caller, ports-and-adapters).
2. Each produced a self-contained design memo with a code sketch.
3. Synthesis pass evaluated the four against the spec's scope constraints (B+ boundary, change pressure on watcher fan-out, test fixture cost).
4. **Decision: Design C base + 2 grafted ports from Design D.**

Recorded in [ADR-0001](./adr/0001-appstate-shape.md). Full design report at [docs/appstate-design-it-twice-2026-05-29.md](./appstate-design-it-twice-2026-05-29.md).

The decision rule that came out of the synthesis — *"one adapter means a hypothetical seam; two adapters means a real one"* — is now a heuristic for future port choices. Six of D's ports were rejected as ceremony (wrapping already-factory-shaped modules); two (`FsEventSource`, `ClientChannel`) earned their keep because they wrap true-external deps that resist deterministic testing.

## Workflow tooling built mid-sprint

Two repeatable workflow scripts were authored and exercised end-to-end during this sprint:

### `architecture-audit.js`
- Walks the repo via the `improve-codebase-architecture` skill.
- Surfaces shallow-module, pass-through-chain, test-friction, and seam-leak candidates.
- Outputs a ranked candidate list (JSON + markdown).
- **This sprint:** 17 candidates surfaced in **~10 minutes**.

### `architecture-design-it-twice.js`
- Takes one candidate from the audit output.
- Spawns 4 parallel sub-agents implementing the INTERFACE-DESIGN.md sub-routine.
- Synthesizes the four memos into an opinionated recommendation.
- **This sprint:** 4 designs + synthesis produced in **~6 minutes** for #92 AppState.

Both workflows are now repeatable for future projects. The audit script's output format feeds directly into `to-issues` for slicing; the design-it-twice output is the raw material for an ADR.

## Code metrics

| Metric | Value |
|---|---|
| PRs merged | 14 |
| Issues shipped (refactors landed) | 8 |
| Issues closed via premise check | 5 |
| Issues closed as test-only additions | 1 |
| New tests added | ~290 |
| `src/server.ts` LOC | **331 → 77** |
| Production regressions | 0 |
| Visible behavior changes | 0 |

`src/server.ts` is now ~77 LOC of pure composition-root wiring — under the ADR-0001 target of ≤150. Path resolvers stay module-level (stateless allocations); everything runtime-stateful moved into `app-state.ts`.

## What's preserved for future audits

- **Premise-check discipline** (see [audit-premise-check-pattern memory](../../../.claude/projects/-home-dbright-claudebot-projects-vibedocs/memory/audit-premise-check-pattern.md))
- **ADR-0001** documenting the AppState shape decision
- **CONTEXT.md** as the canonical domain glossary, written/refined during this sprint
- **architecture-audit + design-it-twice** workflow scripts, repeatable for other projects
- **The two-adapter rule** for port choices ("one adapter is hypothetical; two is real")
