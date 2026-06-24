# VibeDocs v0.2.0 — Launch Readiness Audit

**Audit date:** 2026-06-24 · **Auditor:** automated readiness sweep (issue #126) · **Release under review:** v0.2.0

> This document is the *audit* — evidence gathered in one pass so the maintainer can make the
> go/no-go call. The final decision (and the destructive squash in #128) is the maintainer's;
> what follows is input, not a verdict.

---

## Recommendation (read this first)

**🟢 CORE IS READY — but the launch is GATED on release-logistics issues, not on code quality.**

The codebase itself is in good shape: **653 tests pass with zero failures** (556 backend + 97
frontend), a full **gitleaks history scan finds 0 leaks across 250 commits**, the **v0.2.0 GitHub
Release is already published** (not draft, targets `main`), and the **install/build pipeline
produces a working `vibedocs` bin**. Security posture (CSWSH origin allowlist, safe-by-default
upload auth, read-only mode, gitleaks pre-commit + CI) is documented and enforced by tests.

What is **not** ready is the launch *paperwork and housekeeping* that issue #126 itself enumerates
as the squash preconditions:

1. **~21 open PRs need an explicit fate** — almost all are Dependabot bumps (#115–#149). They must be
   batch-decided before the squash, or they orphan against rewritten history.
2. **Open `npm audit` advisories exist in the working tree** that several of those exact Dependabot
   PRs would clear (vite, vitest, undici). These are dev-dependency advisories, but release hygiene
   wants them resolved or explicitly accepted.
3. **npm publish (#144) has not happened** — `npm view vibedocs` returns 404. If npm distribution is
   a launch deliverable, it's outstanding.
4. **A mermaid fix for #152 has landed on `main` (`11382ce`) but issue #152 is still OPEN** — confirm
   whether it's fully fixed-and-closeable or partially addressed before announcing.

None of these block *today's code*; they are coordination gates. A maintainer who batch-decides the
Dependabot PRs, resolves/accepts the audit advisories, and decides the npm-publish question can move
to **READY TO SQUASH** in a single session.

**Bottom line:** ✅ ship-quality code · ⚠️ launch logistics incomplete. Not yet "✅ READY TO SQUASH".

---

## Per-dimension findings

### ✅ Tests — PASS

Build artifacts were produced fresh (`npm run build:cli` → `tsc` rc=0; `cd frontend && npm install &&
npx vite build` rc=0; `dist-cli/cli/index.js`, `bin/vibedocs`, and `frontend/dist/index.html` all
present), then the full suite ran:

| Suite | Files | Tests | Result |
|---|---|---|---|
| Backend (`vitest run`) | 50 | 556 | ✅ all pass |
| Frontend (`cd frontend && vitest run`) | 14 | 97 | ✅ all pass |
| **Total** | **64** | **653** | **✅ 0 failures** |

Notable coverage includes the structural upload-gate-ordering tests, `package-shape.test.ts` (asserts
the published `files` surface — bin entry, `dist-cli/cli/index.js`, `frontend/dist/index.html`, LICENSE,
README, and *absence* of `.ts`/tsconfig/CLAUDE.md), `cli-bin-smoke.test.ts` (runs the real bin with
`--help`, exit 0), and `mermaid-bundle.test.ts` (inspects dist chunk shape).

### ✅ Security — PASS (with documented, accepted dev-dep advisories)

- **Secret/PII scanning:** `gitleaks detect --config .gitleaks.toml` → **no leaks found, 250 commits
  scanned** (rc=0). The May-2026 PII purge held up. Enforced two ways: a husky `pre-commit` hook
  (`gitleaks protect --staged`, gracefully skips if gitleaks isn't installed locally) and a CI
  backstop (`.github/workflows/gitleaks.yml`) that runs on push/PR to `main` plus a weekly Sunday cron.
- **CSWSH / WebSocket origin:** handshake enforces an Origin allowlist (`src/ws-auth.ts`); defaults
  cover localhost, `VIBEDOCS_WS_ALLOWED_ORIGINS` extends it for tailnet/public, and
  `VIBEDOCS_WS_ALLOW_NO_ORIGIN` defaults to deny — the threat model stays browser-driven CSWSH.
- **Upload auth — safe by default:** uploads are **off** unless `VIBEDOCS_UPLOAD_TOKEN` is set (unset →
  404, so scanners can't fingerprint the feature); bearer comparison is constant-time
  (`crypto.timingSafeEqual`); extension allowlist denies `.html/.svg/.js/...`; per-file size cap.
  Gate ordering is enforced by structural tests.
- **Read-only deployment mode:** `VIBEDOCS_READ_ONLY` returns 404 for `POST /api/upload/*`
  unconditionally (precedence over the token) and hides the upload UI — the intended public-demo posture.

⚠️ **`npm audit` is not clean in the working tree** (this is the only caveat in this dimension):

| Tree | Reported | Notable |
|---|---|---|
| root | 6 vulns (1 low, 2 high, 3 critical) | `vite` 7.0.0–7.3.3 (high), `vitest` ≥4.0.0<4.1.0 (critical — Vitest UI file read/exec), `shell-quote` via `concurrently` (pre-existing dev-dep) |
| frontend | 6 vulns (2 low, 2 mod, 2 high) | `undici` (multiple), `vite` 7.0.0–7.3.3 (high) |

**Every one of these is a build/dev-time dependency, not a runtime/shipped dependency** (vite, vitest,
undici-as-test-fetch, shell-quote-via-concurrently). The critical/high items map directly onto open
Dependabot PRs (#149 vite/tailwind, #136 vite, #122 vitest, #139 undici) — i.e. the fixes are queued,
just not merged. **Action for the maintainer:** merge those bumps (or run `npm audit fix`) before the
squash, or record an explicit "accepted — dev-dep only" decision. The `shell-quote`-via-`concurrently`
advisory is the known pre-existing one and is the weakest case for action.

### ✅ Documentation — PASS

| Doc | Lines | State |
|---|---|---|
| `README.md` | 172 | ✅ Quick start, demo workspace, feature list with screenshots, badges, demo GIF |
| `CLAUDE.md` | — | ✅ Thorough — config table, upload modes, hydration policy, PWA, security patterns |
| `docs/history.md` | 225 | ✅ Curated narrative substitute for the to-be-squashed commit history (the squash's safety net) |
| `docs/adopt-vibedocs.md` | 200 | ✅ Operator guide for the static-site-engine adoption path (S3 + CloudFront) |

Supporting docs present: `docs/architecture.md`, `docs/adr/`, demo `screenshots/`, `vibedocs-demo.gif`.
`docs/history.md` is launch-critical because it preserves the project arc that the #128 squash discards.

### ✅ CI/CD — PASS (single workflow, sufficient for the launch gate)

- **`.github/workflows/gitleaks.yml`** is the only workflow: gitleaks scan on push + PR to `main` +
  weekly cron, full-history fetch on push, uses `.gitleaks.toml` custom rules.
- **Latest gitleaks run on `main`:** ✅ success — run
  [28077020526](https://github.com/danielcbright/vibedocs/actions/runs/28077020526), head
  `62742750…`. Recent dependabot-branch runs are also green.
- **`.github/dependabot.yml`** present — weekly npm updates for `/` and `/frontend`, PR limit 5 each.
- **`scripts/promote.sh`** is the live-service promotion flow (git-status check → backend deps →
  build → validate → restart). Not part of the launch squash, but the daily-deploy path.

⚠️ **No test/typecheck CI workflow exists** — tests run only locally (as done in this audit) and via
`promote.sh`. Acceptable for a solo project, but worth noting: CI's "green" signal currently means
"no secrets leaked," not "tests pass." Consider a test workflow as a post-launch follow-up.

### ⚠️ Versioning / packaging — READY TO INSTALL, NOT YET PUBLISHED

- `package.json` **version: `0.2.0`** ✅ (matches the tag and release).
- **bin:** `{"vibedocs": "./dist-cli/cli/index.js"}` ✅ — smoke-tested by `cli-bin-smoke.test.ts`.
- **`files`:** `["bin/", "dist-cli/", "frontend/dist/**", "LICENSE", "README.md"]` ✅ — enforced by
  `package-shape.test.ts` (no `.ts`, no tsconfig, no CLAUDE.md leak into the package).
- **git-dep install path works** (`npm install -g github:danielcbright/vibedocs`): the `prepare`
  lifecycle script materializes `frontend/dist/` + the CLI on consumer installs; the bin runs.
- ⚠️ **npm registry:** `npm view vibedocs` → **404 (not published)**. **#144 (publish to npm) is OPEN.**
  If the launch includes an npm-installable package (not just the git dep), this is an outstanding
  deliverable. If git-dep-only is acceptable for v0.2.0, it's not a blocker.

### ✅ Release object — PASS

`gh release view v0.2.0` → title "v0.2.0 — Architecture audit landed", **isDraft=false**,
**isPrerelease=false**, **targetCommitish=main**, published 2026-05-30. The v0.2.0 tag currently points
at `72a12d5…`. (Note: the #128 squash will re-point this tag — #128 explicitly carries the recover-the-
release-from-draft step. The release is correct *now*; it must be re-verified *after* the squash.)

---

## Prioritized blocker list

Ordered by what stands between today and "✅ READY TO SQUASH". Per #126, the squash itself is #128
(HITL, maintainer-authorized).

| # | Blocker | Severity | Owner / issue | What "done" looks like |
|---|---|---|---|---|
| 1 | **~21 open PRs lack an explicit fate** (mostly Dependabot #115–#149) | 🔴 Squash-blocking | #126 AC | Batch decision recorded: "merge all" / "close + re-evaluate post-squash" / per-PR. Orphaned PRs after a force-push are messy. |
| 2 | **Open `npm audit` advisories** (vite/vitest/undici high+critical, dev-dep only) | 🟠 Hygiene | #149 #136 #122 #139 | Merge the relevant bumps (or `npm audit fix`), or record "accepted — dev/build-time only." |
| 3 | **npm publish not done** | 🟠 Deliverable (if in scope) | #144 (open) | Decide git-dep-only vs npm; if npm, publish + verify `npm view vibedocs`. |
| 4 | **#152 fix landed on `main` but issue still OPEN** | 🟡 Confirm | #152 | Confirm `11382ce` fully fixes mermaid-on-live; close #152 or re-scope. Don't announce with an open "diagrams don't render" bug if it's actually fixed. |
| 5 | **GitHub Release notes curation** | 🟡 Polish | #145 (open) | Curated v0.2.0 notes (currently "Architecture audit landed"). Must also survive/recover the #128 re-point. |
| 6 | **Maintainer working-tree must be clean at squash time** | 🟡 Pre-flight | #126 AC | `git status --short` clean on the maintainer machine immediately before #128. (This audit ran in an isolated worktree; the maintainer's tree is unverified here.) |
| 7 | **Demo GIF reshoot (mobile + PWA)** | ⚪ Nice-to-have | #147 (open) | Optional for launch; current GIF exists. |
| 8 | **Hosted public demo site** | ⚪ Nice-to-have | #146 (open) | Optional for launch; read-only mode is ready to back it. |

### Issue-label hygiene — ✅ clean

No open issues carry `needs-triage`, and **zero** open issues are unlabeled. The `[launch]` track is
labeled and sequenced (#126 audit → #128 squash → #129 verification → #130 backup).

---

## Evidence appendix (spot-checked, reproducible)

| Claim | Command | Result |
|---|---|---|
| Backend tests | `npx vitest run` | 50 files, 556 tests, **0 fail** |
| Frontend tests | `cd frontend && npx vitest run` | 14 files, 97 tests, **0 fail** |
| Secret scan | `gitleaks detect --config .gitleaks.toml` | **no leaks, 250 commits** |
| Release | `gh release view v0.2.0` | isDraft=false, prerelease=false, target=main |
| CI on main | `gh run list --branch main --workflow gitleaks.yml` | latest = success (run 28077020526) |
| Version/bin/files | `package.json` | 0.2.0 · `dist-cli/cli/index.js` · enforced `files` array |
| Build | `build:cli` + `vite build` | rc=0 each; bin + `frontend/dist/index.html` present |
| npm publish | `npm view vibedocs version` | 404 — not published (#144 open) |
| Open PRs | `gh pr list --state open` | ~21, almost all Dependabot |
| Label hygiene | `gh issue list --label needs-triage` / unlabeled count | empty / 0 |
| #152 fix vs issue state | `git log main` / `gh issue view 152` | fix `11382ce` on main; issue still OPEN |

> Caveat on `main` vs this worktree: this audit ran in a worktree at `6274275`; `main` is one commit
> ahead at `5571bba` (the #152 mermaid fix). Test/audit results are from the worktree checkout; the
> maintainer should re-confirm on a clean `main` checkout immediately before the squash.

---

## Final verdict line

**❌ NOT READY TO SQUASH YET:** code is ship-quality (653 tests pass, 0 leaks, release published), but
the launch is gated on (1) batch-deciding the ~21 open PRs, (2) resolving or accepting the open
`npm audit` advisories, (3) the npm-publish decision (#144), and (4) confirming/closing the #152
mermaid fix. Clear those four and re-run this gate → **✅ READY TO SQUASH**.

*The squash decision (#128) is the maintainer's and requires explicit authorization. This audit is input.*
