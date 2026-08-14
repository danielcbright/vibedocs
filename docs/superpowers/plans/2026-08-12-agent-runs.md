# Agent Runs Implementation Plan

> **Note (2026-08-13):** the `scripts/check-public-safe.sh` gate this plan refers to
> was removed from the repository. Its pattern list necessarily spelled out the
> maintainer's employer and private tooling names, which is the one thing a public
> repo must not carry — a leak guard that leaks defeats itself. The capability now
> lives in the maintainer's local tooling. `gitleaks` (see `.gitleaks.toml`) remains
> the in-repo scanner, and it runs in CI.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live viewer for headless coding-agent runs inside VibeDocs — lane rail on the left, streaming timeline transcript on the right — fed entirely over HTTP by an external dispatch client.

**Architecture:** Three independently testable seams. **Ingest** (`src/agent-runs/`) validates and persists API writes to files on disk. **Format adapters** (`src/agent-runs/formats/`) normalize vendor JSON into one canonical event shape; `cursor-stream-json` is the only adapter this release. **View** (`frontend/src/agent-runs/`) renders canonical events and never parses vendor JSON. Markdown reuses the existing server-side unified pipeline; no client-side markdown or highlighter is added.

**Tech Stack:** Hono 4 + TypeScript backend, React 19 + Tailwind v4 + radix-ui + lucide-react frontend, vitest. One new frontend dependency: `react-virtuoso`.

## Global Constraints

Copied verbatim from the spec (`docs/specs/2026-08-12-agent-runs-design.md`) and the repo's own rules. Every task's requirements implicitly include this section.

- **Vendor-neutral.** No employer name, issue-tracker host, enterprise-VCS host, or dispatch-client specifics in committed code. Those live in operator config and in the client. This ships upstream to `danielcbright/vibedocs`.
- **No emoji anywhere.** lucide-react icons only.
- **Markdown must render.** Reuse `src/markdown-processor.ts` (remark → rehype → `rehype-sanitize` → `@shikijs/rehype`). Do NOT add `react-markdown` or a client-side highlighter.
- **New dependencies near zero.** Compose the `frontend/src/components/ui/` primitives already present (collapsible, badge, card, scroll-area, input, button, separator, tooltip). `react-virtuoso` is the only sanctioned addition. Do not import a rival design system.
- **All agent text is untrusted.** Everything author- or agent-supplied passes through `rehype-sanitize` before reaching the DOM. Linkified output must still be sanitized.
- **Follow mode is anchored at the BOTTOM.** Open a run at the newest event; stay pinned as events arrive; release the pin on scroll-up; floating "jump to latest" re-pins.
- **Status vocabulary:** `running`, `idle`, `blocked`, `waiting`, `done`, `failed`, `stopped`. The client owns the meaning; VibeDocs only renders it.
- **Commands are a closed vocabulary** (`stop` only this release). Never free-text shell. No arbitrary-exec endpoint on the server.
- **Typecheck through the CLI project:** `npx tsc -p tsconfig.cli.json --noEmit`. A bare root `tsc --noEmit` surfaces a different pre-existing error.
- **A clean CLI typecheck does not mean your file was checked.** `tsconfig.cli.json` has an explicit `include` list and reaches everything else by following the import graph from `src/server.ts`. Until Task 7 wires the routes in, **no `src/agent-runs/**` file is in scope at all** — verified 2026-08-12: `--listFiles | grep agent-run` returned nothing while the typecheck reported clean. Two consequences:
  - Before Task 7, check a new module directly: `npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck <file>`.
  - In Task 7, after wiring, **prove** the graph now reaches the feature:
    ```bash
    npx tsc -p tsconfig.cli.json --listFiles | grep -c 'src/agent-runs/'   # must be > 0
    ```
    If it is zero, CI is not typechecking the backend feature and the wiring is incomplete.
- **`npm run verify` is the "am I done?" command.** It runs CI's steps in CI's order.
- **Commit trailers:** `Assisted-by: Claude Opus 5`. Never `Co-Authored-By: Claude ...` (breaks EasyCLA) and never `Claude-Session:` (leaks an internal URL).
- **Commit locally per task; squash once at the end; push exactly once.** Each task ends in its own local commit so a reviewer can step through the work and a bad task can be dropped. Nothing is pushed until Task 19 squashes the branch into a single commit. **Never push an intermediate commit** — doing so turns the squash into a force-push over a published branch.
- **Identity is per-clone and already configured. Do not change it, and never touch global state.** Verified 2026-08-12 on this clone:

  | Setting | Value | Why |
  |---|---|---|
  | `--local user.email` | `danielcbright@gmail.com` | Matches all 150 existing commits in this repo. This is a personal MIT project, so an employer address here would both break authorship consistency and put that domain permanently into public history. |
  | `--local user.name` | `Daniel Bright` | |
  | `--local credential.helper` and `--local credential.https://github.com.helper` | `gh auth token --user danielcbright` | Without these, `git push` resolves through the *global* URL-scoped helper to whichever account is active — on this machine a managed enterprise identity that cannot touch this repo. The failure reads like a permissions bug, not a config one. |

  Three hard rules: **never** `git config --global` anything in this tree; **never** `gh auth switch`; **never** point `GH_HOST` at the enterprise VCS host. For any `gh` call here, pass the account inline — `GH_TOKEN=$(gh auth token --user danielcbright) gh <command>` — because the ambient `GH_TOKEN` in this shell authenticates as the managed enterprise identity and takes precedence over the keyring.

  Verify by resolution, never by reading config back:

  ```bash
  printf 'protocol=https\nhost=github.com\n\n' | git credential fill | grep '^username='   # must print username=danielcbright
  git config user.email                                                                    # must print danielcbright@gmail.com
  ```
- **Nothing that reaches the public repo may name the employer or any internal system.** This binds committed files, commit messages, filed issues, and PR bodies alike — none may mention the employer by name, nor an internal tracker key, internal hostname, internal repo or team name, or a local research path outside this repo. Reference upstream issue numbers instead. The subtle case is prose that reads as generic but names one internal thing in passing, so the check is mechanical:

  ```bash
  ./scripts/check-public-safe.sh      # scans staged changes; exit 0 means safe to commit
  ```

  The gate lives in `scripts/check-public-safe.sh` (created in Task 1) rather than as an inline grep, for a reason worth stating: the pattern list contains the very strings it searches for, so any document that spells the gate out inline can never pass its own check. The script therefore excludes exactly one file — itself — and no document is exempt. The one sanctioned exception is the author email in commit metadata, which is required for auditability.

### Decisions taken 2026-08-12 (do not reopen)

| Decision | Choice |
|---|---|
| Transcript layout | Timeline (bake-off v2): vertical rail, monospace timestamp gutter, one node per event |
| Write auth | **Split.** Ingest (`POST /api/runs`, `POST …/events`, `POST …/ack`) requires the bearer token. Control (`PATCH /api/runs/:id`, `POST …/commands`) requires only a same-origin `Origin` header. Reads open on loopback. |
| Raw retention | **Canonical only.** `events.ndjson` holds canonical records; `meta.json` records `adapterVersion`. No `raw.ndjson`. |
| Config source | `~/.vibedocs/agent-runs.json` (linkify patterns + editor scheme). Feature gated by `VIBEDOCS_RUNS_ENABLED`, default off. |
| Sequencing | **Thin vertical slice first** — Phase A gets one real run rendering end to end, Phase B widens. |

### Data facts established from the eight real transcripts in `the local transcript directory`

These are measured, not assumed. The adapter is written against them.

1. **`call_id` contains an embedded newline** — 156 of 156 tool calls in `transcript A`. Split on `\n`, keep segment 0, or started/completed never pair.
2. **Missing `timestamp_ms`** on `system/init`, `user`, `result`, and 1 of 8 `assistant` events. Rule: server-stamp **any** event lacking `ts`. (The spec named only init and result.)
3. **Failures use a separate discriminator.** Not `success: <non-dict>` — it is `result: { failure: { command, exitCode, signal, stdout, stderr, executionTime, … } }`. 37 across the eight lanes. The reference `normalize-cursor-events.py:87-89` JSON-dumps this into `error` and loses stdout/stderr/exitCode. Model `result` as `{ success } | { failure }`.
4. **Raw is enormous and mostly junk.** `transcript C` is 5.8 MB / 467 events; `transcript B` is 3.1 MB / 1973 events; max single line 63 KB. The bulk is `editToolCall.result.success.beforeFullFileContent` + `afterFullFileContent` (the entire file, twice, per edit) and `shellToolCall.args.parsingResult.executableCommands` (a full shell AST). Both are dropped at ingest.
5. **`linesAdded` / `linesRemoved` are strings** in edit results (`'9'`, `'0'`). Coerce with `Number()`.
6. **`exitCode` is always an int** across all eight lanes, in both success and failure bodies.
7. **`tool_call.<kind>.startedAtMs` exists as a string** — a usable `ts` fallback for tool events.
8. **Multiple `result` events per run.** `transcript C` has three (resumed turns), one with a 706-char body. A run is not "one turn".
9. **`connection/reconnecting`, `connection/reconnected`, `retry/starting`, `retry/resuming`** all appear and map to `kind: 'other'`.
10. **Thinking arrives as delta + `completed` terminator pairs** (48/48 in `transcript A`), not per-token in practice — but the adapter must not assume that.

### Two design refinements this plan makes over the spec

Both are consequences of the data facts above. Flagged because they change the wire format.

**1. `events.ndjson` is an append-only log of _records_, not of events.** The spec asks for tool `started` + `completed` merged into one event, but an append-only file cannot mutate an already-written line, and dropping `started` would mean a running tool is invisible while it runs — which defeats live viewing. So a line is either an append or a patch:

```ts
type EventRecord =
  | { op: 'append'; event: AgentEvent }
  | { op: 'patch'; seq: number; patch: Partial<AgentEvent> }
```

`started` appends an event with `tool.status: 'running'`; `completed` emits a patch against that `seq`. One shared `applyRecords()` fold produces the logical event list, and both server and frontend use it — so initial load and reconnect catch-up are the same code path. Reads are paged by **record** position (`?fromRec=N`), never by event seq, because a patch can target an event older than anything in the page.

**2. `createMarkdownProcessor` gets split rather than reused as-is.** `RewriteOptions` requires `mode`, `projectName`, and `currentDocPath` — project-doc concepts an agent-run event does not have; passing empty strings would emit `/api/file//…` URLs. And `rehype-slug` + `rehype-autolink-headings` would mint duplicate DOM ids the moment two events both contain `## Summary`, which on a timeline page is routine. Agent text therefore gets its own factory sharing the same remark/rehype/shiki/sanitize spine, minus URL rewriting and heading anchors, and with rehype-sanitize's id-clobbering left **on** (the existing page schema disables it, justified by one page per render; a timeline renders many untrusted blocks into one document).

---

## File Structure

### Backend — new

| File | Responsibility |
|---|---|
| `src/shared/agent-run-types.ts` | Canonical `AgentEvent`, `EventRecord`, `RunMeta`, `RunStatus`, `RunLink`, `RunCommand`, and the `applyRecords` fold. Shared with the frontend via `@shared/*`. |
| `src/shared/agent-runs-config-types.ts` | `AgentRunsClientConfig` (linkify rules + editor scheme) — shared so the frontend can linkify. |
| `src/agent-runs/config.ts` | `parseAgentRunsEnv(env)` + `loadAgentRunsConfigFile(dir)`. Pure + one fs read. |
| `src/agent-runs/store.ts` | `createRunStore({ runsDir })`. Owns `meta.json` / `events.ndjson`, seq + rec assignment, atomic meta writes, batch idempotency. |
| `src/agent-runs/formats/types.ts` | `FormatAdapter` interface + `AdapterState`. |
| `src/agent-runs/formats/cursor-stream-json.ts` | The cursor adapter. All ten data facts live here. |
| `src/agent-runs/formats/index.ts` | Adapter registry: `getAdapter(format)`. |
| `src/agent-runs/ingest.ts` | Orchestration: per-run adapter state, normalize → append → broadcast. |
| `src/agent-runs/commands.ts` | Command queue: enqueue, poll, ack. |
| `src/agent-runs/auth.ts` | `checkRunsIngestAuth` (bearer) + `checkRunsControlAuth` (same-origin). |
| `src/agent-runs/routes.ts` | `registerAgentRunsRoutes(app, deps)`. |
| `src/agent-runs/text-render.ts` | `renderAgentText(md)` + content-hash cache. |
| `src/bearer-auth.ts` | `checkBearerToken(expected, header)` — constant-time, extracted from `upload-auth.ts`. |
| `scripts/replay-transcript.mjs` | Dev tool: POST any ndjson file at a running server. Generic, takes a path arg. |

### Backend — modified

| File | Change |
|---|---|
| `src/upload-auth.ts` | `checkUploadAuth` delegates its bearer comparison to `src/bearer-auth.ts`. Public API unchanged. |
| `src/markdown-processor.ts` | Extract the shared spine; add `createAgentTextProcessor()`. `createMarkdownProcessor` behaviour unchanged. |
| `src/markdown-plugins.ts` | Add `agentTextSanitizeSchema` (= `sanitizeSchema` with id-clobbering restored). |
| `src/shared/ws-messages.ts` | Add `run-updated` + `run-records` variants (nudges, not payloads). |
| `src/app-state.ts` | Own the `RunStore` + adapter state; expose `agentRuns`. |
| `src/server.ts` | Register the routes; log the runs mode. |
| `src/upload-route.ts` | `/api/config` also reports `runsEnabled`. |

### Frontend — new

| File | Responsibility |
|---|---|
| `frontend/src/agent-runs/RunsView.tsx` | Shell: resizable rail + detail. |
| `frontend/src/agent-runs/RunRail.tsx` | Grouped rail (active above, done below), status icons, clickable issue key. |
| `frontend/src/agent-runs/RunHeader.tsx` | Run identity, links, lifecycle buttons. |
| `frontend/src/agent-runs/Timeline.tsx` | Virtuoso list + the vertical spine. |
| `frontend/src/agent-runs/TimelineRow.tsx` | One event node: icon, gutter, collapsible body, copy affordances. |
| `frontend/src/agent-runs/FilterBar.tsx` | Text filter + all/tools/failures/narrative. |
| `frontend/src/agent-runs/hooks/use-runs.ts` | Rail data + WS invalidation. |
| `frontend/src/agent-runs/hooks/use-run-records.ts` | Record paging + `applyRecords` fold + reconnect catch-up. |
| `frontend/src/agent-runs/hooks/use-follow-mode.ts` | Pin / release / re-pin. Pure reducer + hook. |
| `frontend/src/agent-runs/lib/linkify.ts` | Config-driven linkification. |
| `frontend/src/agent-runs/lib/tool-display.ts` | `toolLabel`, `toolSummary`, `toolLang`, `shortenPath`, `fmtTime`, `fmtDuration`. |
| `frontend/src/agent-runs/components/{CopyButton,CodeBlock,Linked,StatusIcon,ToolIcon,KindIcon}.tsx` | Ported from the bake-off `kit.tsx` / `shared.tsx`. |

### Tests — new

`tests/agent-runs-{cursor-adapter,store,ingest,auth,routes,commands,text-render,records-fold}.test.ts`, `tests/agent-runs-fixtures.ts`, and `frontend/tests/agent-runs-{follow-mode,filter,timeline-row}.test.tsx`.

---

# Phase A — vertical slice

Goal of the phase: push `the local transcript directory transcript A/events.ndjson` at a running server and see it render as a timeline with real markdown. No follow mode, no filters, no virtualization, no commands yet.

### Task 1: Commit the spec, and land the shared types + record fold

The fold is the contract both sides depend on, so it comes first and it is unit-tested before anything writes a file.

**Files:**
- Create: `src/shared/agent-run-types.ts`
- Create: `tests/agent-runs-records-fold.test.ts`
- Commit (already on disk, untracked): `docs/specs/2026-08-12-agent-runs-design.md`
- Commit (this file): `docs/superpowers/plans/2026-08-12-agent-runs.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `RunStatus`, `LinkKind`, `RunLink`, `EventKind`, `ToolStatus`, `ToolInfo`, `AgentEvent`, `EventRecord`, `RunMeta`, `RunCommand`, `RunCommandKind`, `applyRecords(events, records)`, `MAX_TOOL_OUTPUT_BYTES`, `ADAPTER_VERSION`.

- [ ] **Step 1: Sanitize the spec and this plan before committing either**

Both documents are the reference every later task cites, so they land as the first commit — but **neither is publishable as written.** The spec currently names the employer at line 22 and carries local research paths at lines 5, 6, 142, 215 and 233; this plan cites the same paths and the real lane directory names. Committing them verbatim would put all of it in a public repo.

Make exactly these replacements in `docs/specs/2026-08-12-agent-runs-design.md`:

| Where | Replace | With |
|---|---|---|
| Line 5–6 (header refs) | the two local research paths | `> Reference implementation and component research: kept outside this repo (local notes).` |
| Line 22 | the clause naming the dispatch script, the tracker, and the employer | `about the dispatch client or any issue tracker; clients push` |
| Line 116 | `what \`READY-NOT-MERGED\` maps to` | `what a "finished but unlanded" client state maps to` |
| Line 142 | the local path to the timeline variant's source | `the timeline variant of the local layout bake-off` |
| Line 199 | `clicking the key opens Jira` | `clicking the key opens the configured issue URL` |
| Line 215 | the client's per-ticket status-file path | `its own status file` |
| Line 233 | `` (fixtures from `the local transcript directory */events.ndjson`) `` | `(fixtures synthesized from real captured transcripts)` |

And in this plan file, replace every `the local transcript directory` reference and every real lane name (`transcript A`, `transcript B`, `transcript C`) with neutral equivalents — `a local transcript directory`, `transcript A` / `transcript B` / `transcript C`. The measured numbers (5.8 MB, 1973 events, 156/156, 37 failures) stay; they are the evidence and they name nothing.

Then write the gate every later task depends on: **`scripts/check-public-safe.sh`**.

It scans *staged* changes — exactly the bytes about to enter history — for internal
identifiers: the employer name, internal hostnames, internal tracker keys, and local
research paths outside this repo. It exits non-zero and prints the offending lines.

The script excludes **itself** from its own scan, and nothing else. That exclusion is
unavoidable: the pattern list necessarily contains the strings it searches for, so without
it the gate could never pass. Keeping the exclusion to one file is the point — a blanket
exemption for a document would quietly stop protecting that document. Read the script for
the current pattern list rather than duplicating it anywhere.

Make it executable, then verify and commit:

```bash
cd /Users/dabright/Development/external-public/vibedocs
git config user.email    # must print danielcbright@gmail.com — see Global Constraints
git checkout -b feat/agent-runs

# Record the branch point once. Task 19 squashes back to exactly this commit,
# and reading it from a variable beats re-deriving a merge-base 18 tasks later.
git rev-parse HEAD > .git/agent-runs-base

chmod +x scripts/check-public-safe.sh
git add scripts/check-public-safe.sh docs/specs/2026-08-12-agent-runs-design.md \
        docs/superpowers/plans/2026-08-12-agent-runs.md

./scripts/check-public-safe.sh    # must print "public-safe: clean"

git commit -m "docs(agent-runs): design spec, implementation plan, and a leak gate

scripts/check-public-safe.sh scans staged changes for internal identifiers so
they cannot reach this public repository. It excludes itself and the plan,
because the pattern list contains the strings it searches for.

Assisted-by: Claude Opus 5"
```

If the gate exits non-zero, do not commit — sanitize the reported hit first.

The single exclusion is deliberate and narrow: every other file, including every future one, is scanned. If a later task wants a new exclusion, that is a signal the content is wrong, not the gate.

- [ ] **Step 2: Write the failing fold test**

Create `tests/agent-runs-records-fold.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyRecords, type EventRecord, type AgentEvent } from '../src/shared/agent-run-types.js'

function ev(seq: number, over: Partial<AgentEvent> = {}): AgentEvent {
  return { seq, ts: 1000 + seq, kind: 'other', ...over }
}

describe('applyRecords', () => {
  it('appends events in seq order', () => {
    const records: EventRecord[] = [
      { op: 'append', event: ev(1, { kind: 'user', text: 'go' }) },
      { op: 'append', event: ev(2, { kind: 'assistant', text: 'ok' }) },
    ]
    const out = applyRecords([], records)
    expect(out.map((e) => e.seq)).toEqual([1, 2])
    expect(out[0].text).toBe('go')
  })

  it('folds a patch into an earlier event, merging the tool sub-object', () => {
    const records: EventRecord[] = [
      {
        op: 'append',
        event: ev(1, {
          kind: 'tool',
          tool: { name: 'shell', callId: 'c1', label: 'ls', args: {}, status: 'running' },
        }),
      },
      { op: 'append', event: ev(2, { kind: 'assistant', text: 'meanwhile' }) },
      {
        op: 'patch',
        seq: 1,
        patch: { tool: { status: 'success', exitCode: 0, output: 'a\nb', endTs: 2000 } as any },
      },
    ]
    const out = applyRecords([], records)
    expect(out).toHaveLength(2)
    expect(out[0].tool).toMatchObject({
      name: 'shell',       // preserved from the append
      callId: 'c1',        // preserved
      label: 'ls',         // preserved
      status: 'success',   // overwritten
      exitCode: 0,
      output: 'a\nb',
      endTs: 2000,
    })
    expect(out[1].text).toBe('meanwhile')  // ordering unaffected by the patch
  })

  it('is incremental: folding a second page onto a prior result matches folding all at once', () => {
    const page1: EventRecord[] = [
      {
        op: 'append',
        event: ev(1, { kind: 'tool', tool: { name: 'shell', callId: 'c1', label: 'ls', args: {}, status: 'running' } }),
      },
    ]
    const page2: EventRecord[] = [{ op: 'patch', seq: 1, patch: { tool: { status: 'success' } as any } }]
    const incremental = applyRecords(applyRecords([], page1), page2)
    const allAtOnce = applyRecords([], [...page1, ...page2])
    expect(incremental).toEqual(allAtOnce)
  })

  it('ignores a patch for an unknown seq rather than throwing', () => {
    const out = applyRecords([], [{ op: 'patch', seq: 99, patch: { text: 'x' } }])
    expect(out).toEqual([])
  })

  it('does not mutate the events array passed in', () => {
    const prior = applyRecords([], [{ op: 'append', event: ev(1, { text: 'first' }) }])
    const frozen = JSON.parse(JSON.stringify(prior))
    applyRecords(prior, [{ op: 'patch', seq: 1, patch: { text: 'changed' } }])
    expect(prior).toEqual(frozen)
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/agent-runs-records-fold.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/agent-run-types.js'`.

- [ ] **Step 4: Write the types and the fold**

Create `src/shared/agent-run-types.ts`:

```ts
/**
 * Canonical Agent Runs wire types — shared between the Hono backend (src/) and
 * the React frontend (frontend/src/, via the `@shared/*` alias).
 *
 * Vendor-neutral by construction: nothing here knows about cursor, Jira, or any
 * particular agent. Format adapters (src/agent-runs/formats/) map vendor JSON
 * into these shapes; the frontend only ever sees these shapes.
 */

export type RunStatus =
  | 'running'   // agent is working
  | 'idle'      // alive, nothing in flight
  | 'blocked'   // needs a human
  | 'waiting'   // finished its turn, work not landed yet
  | 'done'
  | 'failed'
  | 'stopped'

export const RUN_STATUSES: readonly RunStatus[] = [
  'running', 'idle', 'blocked', 'waiting', 'done', 'failed', 'stopped',
]

/** Display hint that selects the lucide icon. VibeDocs never builds the URL. */
export type LinkKind = 'issue' | 'pr' | 'ci' | 'other'

export interface RunLink {
  label: string
  url: string
  kind: LinkKind
}

export type EventKind =
  | 'init' | 'user' | 'thinking' | 'assistant' | 'tool' | 'result' | 'other'

export type ToolStatus = 'running' | 'success' | 'error'

export interface ToolInfo {
  /** Vendor-neutral tool name: 'shell' | 'read' | 'edit' | 'grep' | 'glob' | … */
  name: string
  callId: string
  /** One-line display form: the command, or a path relative to the run's workdir. */
  label: string
  /** Projected args — display-relevant fields only. See the adapter. */
  args: Record<string, unknown>
  status: ToolStatus
  exitCode?: number
  output?: string
  /** True when `output` was cut at MAX_TOOL_OUTPUT_BYTES. */
  outputTruncated?: boolean
  linesAdded?: number
  linesRemoved?: number
  endTs?: number
}

export interface AgentEvent {
  /** Server-assigned, monotonic per run, 1-based. */
  seq: number
  /** Epoch ms. Server-stamped when the client omits it — never assume the vendor sent one. */
  ts: number
  kind: EventKind
  /** user/assistant/thinking/result body. Markdown for assistant + result. */
  text?: string
  tool?: ToolInfo
  /** Kind-specific: durationMs, inputTokens, outputTokens, sessionId, model, isError. */
  meta?: Record<string, unknown>
}

/**
 * A line of events.ndjson.
 *
 * The file is append-only, so a tool call that starts and later completes
 * cannot be rewritten in place. `started` appends an event with
 * tool.status === 'running' (so a live viewer sees it immediately) and
 * `completed` emits a patch against that seq. `applyRecords` folds the log
 * into the logical event list.
 */
export type EventRecord =
  | { op: 'append'; event: AgentEvent }
  | { op: 'patch'; seq: number; patch: Partial<AgentEvent> }

export interface RunMeta {
  id: string
  title: string
  description?: string
  status: RunStatus
  links: RunLink[]
  /** Adapter key, e.g. 'cursor-stream-json'. */
  format: string
  /** Free-text agent identity, e.g. 'cursor-agent'. Display only. */
  agent?: string
  /** Absolute path the agent ran in. Used to shorten displayed paths. */
  workdir?: string
  createdAt: number
  updatedAt: number
  /** Count of logical events (appends only). */
  eventCount: number
  /** Count of lines in events.ndjson (appends + patches). Paging key. */
  recCount: number
  /** Which adapter version produced these records. Canonical-only storage means
   *  old runs keep whatever the adapter of the day emitted. */
  adapterVersion: number
  /** Highest client-supplied batch sequence accepted. Batch idempotency key. */
  lastClientSeq?: number
  /** True while a stop command is queued and unacked. */
  stopRequested?: boolean
}

export type RunCommandKind = 'stop'

export interface RunCommand {
  id: string
  kind: RunCommandKind
  createdAt: number
  ackedAt?: number
  /** Client-reported outcome. Free text, display only. */
  ackNote?: string
}

/** Per-event cap on stored tool output. Beyond this, truncate and flag. */
export const MAX_TOOL_OUTPUT_BYTES = 256 * 1024

/** Bump when adapter output changes shape. Recorded in meta.json. */
export const ADAPTER_VERSION = 1

/**
 * Fold an ordered run of records onto a prior event list.
 *
 * Pure and incremental: applyRecords(applyRecords([], a), b) equals
 * applyRecords([], [...a, ...b]). Never mutates `events`. A patch for an
 * unknown seq is ignored rather than thrown — a client that pages from a
 * non-zero record offset legitimately sees patches for events it has.
 */
export function applyRecords(
  events: readonly AgentEvent[],
  records: readonly EventRecord[],
): AgentEvent[] {
  const bySeq = new Map<number, AgentEvent>()
  const order: number[] = []
  for (const e of events) {
    bySeq.set(e.seq, e)
    order.push(e.seq)
  }

  for (const rec of records) {
    if (rec.op === 'append') {
      if (!bySeq.has(rec.event.seq)) order.push(rec.event.seq)
      bySeq.set(rec.event.seq, rec.event)
      continue
    }
    const existing = bySeq.get(rec.seq)
    if (!existing) continue
    const { tool: toolPatch, meta: metaPatch, ...rest } = rec.patch
    bySeq.set(rec.seq, {
      ...existing,
      ...rest,
      // tool and meta merge field-wise: the patch carries only what changed
      // (status/exitCode/output), and must not drop name/callId/label/args.
      ...(toolPatch ? { tool: { ...(existing.tool ?? {}), ...toolPatch } as ToolInfo } : {}),
      ...(metaPatch ? { meta: { ...(existing.meta ?? {}), ...metaPatch } } : {}),
    })
  }

  return order.map((seq) => bySeq.get(seq)!).sort((a, b) => a.seq - b.seq)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/agent-runs-records-fold.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc -p tsconfig.cli.json --noEmit`
Expected: no output.

```bash
git add src/shared/agent-run-types.ts tests/agent-runs-records-fold.test.ts
git commit -m "feat(agent-runs): canonical event types + append/patch record fold

events.ndjson is append-only, so a tool call cannot be rewritten when it
completes. Model the file as a log of records: 'started' appends an event with
status running (visible to a live viewer immediately), 'completed' patches it.
applyRecords folds the log and is incremental, so initial load and reconnect
catch-up share one code path.

Assisted-by: Claude Opus 5"
```

---

### Task 2: The cursor-stream-json adapter

The whole release's correctness sits here. Every one of the ten data facts is a test.

**Fixtures must be synthetic.** The real transcripts in the local transcript directory are saturated with internal tracker keys, internal repo names, and employer paths. `external-public/CLAUDE.md` §5 forbids any of that entering a public repo, and "a realistic-looking test fixture pasted from a real internal payload" is called out there as the subtle failure case. So committed fixtures are hand-written to reproduce the *structure* of each fact with neutral content (`PROJ-1`, `/home/dev/app`, `example.com`). The real transcripts get used in Step 8 as a local, uncommitted sanity run.

**Files:**
- Create: `src/agent-runs/formats/types.ts`
- Create: `src/agent-runs/formats/cursor-stream-json.ts`
- Create: `src/agent-runs/formats/index.ts`
- Create: `tests/agent-runs-fixtures.ts`
- Create: `tests/agent-runs-cursor-adapter.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `EventRecord`, `ToolInfo`, `MAX_TOOL_OUTPUT_BYTES`, `ADAPTER_VERSION` from Task 1.
- Produces:
  - `interface FormatAdapter { name: string; version: number; createState(): AdapterState; normalize(raw: unknown[], state: AdapterState, ctx: NormalizeCtx): PendingRecord[] }`
  - `type PendingRecord = { op: 'append'; event: Omit<AgentEvent, 'seq'> } | { op: 'patch'; callId: string; patch: Partial<AgentEvent> }` — the adapter cannot know real `seq` numbers, so it patches by `callId` and the store resolves that to a seq (Task 3).
  - `type NormalizeCtx = { now: () => number }`
  - `getAdapter(format: string): FormatAdapter | null`
  - `cursorStreamJsonAdapter: FormatAdapter`

- [ ] **Step 1: Write the adapter interface**

Create `src/agent-runs/formats/types.ts`:

```ts
import type { AgentEvent } from '../../shared/agent-run-types.js'

/**
 * A record an adapter wants written, before the store assigns identity.
 *
 * An adapter sees a batch of vendor lines and no global state, so it cannot
 * know seq numbers. A tool completion therefore patches by `callId`; the store
 * resolves callId -> seq (it owns the callId index) and writes a real
 * { op: 'patch', seq } line. See src/agent-runs/store.ts.
 */
export type PendingRecord =
  | { op: 'append'; event: Omit<AgentEvent, 'seq'> }
  | { op: 'patch'; callId: string; patch: Partial<AgentEvent> }

/** Opaque per-run carry-over. Adapters define their own shape. */
export interface AdapterState {
  [key: string]: unknown
}

export interface NormalizeCtx {
  /** Injected clock — server-stamps events the vendor left without a timestamp. */
  now: () => number
}

export interface FormatAdapter {
  /** Wire key, e.g. 'cursor-stream-json'. */
  readonly name: string
  readonly version: number
  createState(): AdapterState
  /**
   * Normalize one batch. `state` carries across batches within a run — a
   * thinking burst or a tool call may span batch boundaries.
   */
  normalize(raw: unknown[], state: AdapterState, ctx: NormalizeCtx): PendingRecord[]
}
```

- [ ] **Step 2: Write the synthetic fixtures**

Create `tests/agent-runs-fixtures.ts`. Each export reproduces one measured structural fact with neutral content.

```ts
/**
 * Synthetic cursor-agent stream-json events.
 *
 * Deliberately NOT copied from a real transcript: real ones carry internal
 * issue keys, repo names and employer paths, which must never enter this
 * public repo (external-public/CLAUDE.md §5). Each fixture reproduces the
 * *structure* of a fact measured from real data — see the plan's "Data facts"
 * table — with neutral placeholder content.
 */

/** Fact 1: call_id carries an embedded newline. Both phases carry the same one. */
export const CALL_ID_WITH_NEWLINE =
  'call_AbCdEf123456\nfc_02fa42882cc621fd016a7b96e5de488190bf990483f88d3952'

/** Fact 2: system/init has no timestamp_ms at all. */
export const INIT_NO_TS = {
  type: 'system',
  subtype: 'init',
  apiKeySource: 'login',
  cwd: '/home/dev/app',
  session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  model: 'Auto Cost',
  permissionMode: 'default',
}

/** Fact 2: user has no timestamp_ms either (the spec only named init + result). */
export const USER_NO_TS = {
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'text', text: '# PROJ-1 — add a health endpoint\n\nBranch: `feat/health`.' }],
  },
}

/** Fact 10: thinking arrives as deltas followed by a `completed` terminator. */
export const THINKING_DELTAS = [
  { type: 'thinking', subtype: 'delta', text: '**Reading** the ', timestamp_ms: 1_700_000_001_000 },
  { type: 'thinking', subtype: 'delta', text: 'router setup', timestamp_ms: 1_700_000_001_100 },
  { type: 'thinking', subtype: 'completed', timestamp_ms: 1_700_000_001_200 },
]

/** Assistant text is markdown and must survive verbatim for the renderer. */
export const ASSISTANT_MD = {
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: '## Plan\n\n- read `router.ts`\n- **add** the route' }],
  },
  session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  timestamp_ms: 1_700_000_002_000,
}

/** Fact 2: an assistant event with no timestamp_ms (1 of 8 in real data). */
export const ASSISTANT_NO_TS = {
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Continuing.' }] },
}

/** Fact 4 + 7: args carry a full shell AST to be dropped; startedAtMs is a string. */
export const SHELL_STARTED = {
  type: 'tool_call',
  subtype: 'started',
  call_id: CALL_ID_WITH_NEWLINE,
  tool_call: {
    shellToolCall: {
      args: {
        command: 'npm test',
        workingDirectory: '/home/dev/app',
        timeout: 30000,
        toolCallId: CALL_ID_WITH_NEWLINE,
        simpleCommands: ['npm'],
        hasInputRedirect: false,
        hasOutputRedirect: false,
        // Fact 4: this whole subtree is junk for display and must be dropped.
        parsingResult: {
          parsingFailed: false,
          executableCommands: [
            { name: 'npm', args: [{ type: 'word', value: 'test' }], fullText: 'npm test' },
          ],
        },
      },
      toolCallId: CALL_ID_WITH_NEWLINE,
      startedAtMs: '1700000003000',
    },
    hookAdditionalContexts: [],
  },
  session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  timestamp_ms: 1_700_000_003_000,
}

/** Fact 6: exitCode is an int, inside result.success. */
export const SHELL_COMPLETED_OK = {
  type: 'tool_call',
  subtype: 'completed',
  call_id: CALL_ID_WITH_NEWLINE,
  tool_call: {
    shellToolCall: {
      args: { command: 'npm test', workingDirectory: '/home/dev/app' },
      result: {
        success: {
          command: 'npm test',
          workingDirectory: '/home/dev/app',
          exitCode: 0,
          signal: '',
          stdout: '5 passing\n',
          stderr: '',
          executionTime: 1200,
          interleavedOutput: '5 passing\n',
        },
        isBackground: false,
      },
    },
  },
  timestamp_ms: 1_700_000_004_000,
}

/**
 * Fact 3: failure is a SEPARATE discriminator carrying real stdout/stderr and
 * exitCode — not `success: <non-dict>`. The reference python collapsed this to
 * an opaque blob and lost the diagnostics.
 */
export const SHELL_COMPLETED_FAILURE = {
  type: 'tool_call',
  subtype: 'completed',
  call_id: 'call_FailCase0001\nfc_deadbeef',
  tool_call: {
    shellToolCall: {
      args: { command: 'npm run build', workingDirectory: '/home/dev/app' },
      result: {
        failure: {
          command: 'npm run build',
          workingDirectory: '/home/dev/app',
          exitCode: 1,
          signal: '',
          stdout: '',
          stderr: 'error TS2304: Cannot find name "foo".\n',
          executionTime: 900,
          interleavedOutput: 'error TS2304: Cannot find name "foo".\n',
        },
      },
    },
  },
  timestamp_ms: 1_700_000_005_000,
}

export const SHELL_STARTED_FAILURE = {
  type: 'tool_call',
  subtype: 'started',
  call_id: 'call_FailCase0001\nfc_deadbeef',
  tool_call: {
    shellToolCall: {
      args: { command: 'npm run build', workingDirectory: '/home/dev/app' },
      startedAtMs: '1700000004500',
    },
  },
  timestamp_ms: 1_700_000_004_500,
}

/** Fact 5: linesAdded/linesRemoved are STRINGS; whole-file contents must be dropped. */
export const EDIT_COMPLETED = {
  type: 'tool_call',
  subtype: 'completed',
  call_id: 'call_EditCase01\nfc_cafe',
  tool_call: {
    editToolCall: {
      args: { path: '/home/dev/app/src/router.ts' },
      result: {
        success: {
          path: '/home/dev/app/src/router.ts',
          linesAdded: '9',
          linesRemoved: '0',
          diffString: '--- a/src/router.ts\n+++ b/src/router.ts\n@@\n+app.get("/health", h)\n',
          // Fact 4: the entire file, twice. Dropped at ingest.
          beforeFullFileContent: 'x'.repeat(5000),
          afterFullFileContent: 'y'.repeat(5000),
          message: 'The file /home/dev/app/src/router.ts was edited.',
        },
      },
    },
  },
  timestamp_ms: 1_700_000_006_000,
}

export const READ_STARTED = {
  type: 'tool_call',
  subtype: 'started',
  call_id: 'call_ReadCase01\nfc_beef',
  tool_call: {
    readToolCall: { args: { path: '/home/dev/app/src/router.ts' }, startedAtMs: '1700000007000' },
  },
  timestamp_ms: 1_700_000_007_000,
}

export const GREP_STARTED = {
  type: 'tool_call',
  subtype: 'started',
  call_id: 'call_GrepCase01\nfc_f00d',
  tool_call: {
    grepToolCall: {
      args: {
        pattern: 'health|router',
        path: '/home/dev/app',
        outputMode: 'files_with_matches',
        caseInsensitive: false,
        multiline: false,
        offset: 0,
      },
      startedAtMs: '1700000008000',
    },
  },
  timestamp_ms: 1_700_000_008_000,
}

/** Fact 2 + 8: result has no timestamp_ms, and a run can contain several. */
export const RESULT_NO_TS = {
  type: 'result',
  subtype: 'success',
  duration_ms: 1_491_836,
  duration_api_ms: 1_491_836,
  is_error: false,
  result: '## Done\n\nAdded `/health`. See PROJ-1.',
  session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  request_id: 'rrrrrrrr-1111-2222-3333-444444444444',
  usage: { inputTokens: 10367, outputTokens: 3083, cacheReadTokens: 1_658_368, cacheWriteTokens: 0 },
}

/** Fact 8: a resumed turn whose result body is empty. */
export const RESULT_EMPTY_BODY = {
  type: 'result',
  subtype: 'success',
  duration_ms: 4200,
  is_error: false,
  result: '',
  usage: { inputTokens: 10, outputTokens: 0 },
}

/** Fact 9: connection/retry chatter maps to kind 'other'. */
export const CONNECTION_EVENTS = [
  { type: 'connection', subtype: 'reconnecting', timestamp_ms: 1_700_000_009_000 },
  { type: 'retry', subtype: 'starting', timestamp_ms: 1_700_000_009_100 },
  { type: 'retry', subtype: 'resuming', timestamp_ms: 1_700_000_009_200 },
  { type: 'connection', subtype: 'reconnected', timestamp_ms: 1_700_000_009_300 },
]
```

- [ ] **Step 3: Write the failing adapter tests**

Create `tests/agent-runs-cursor-adapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cursorStreamJsonAdapter as adapter } from '../src/agent-runs/formats/cursor-stream-json.js'
import { getAdapter } from '../src/agent-runs/formats/index.js'
import { MAX_TOOL_OUTPUT_BYTES } from '../src/shared/agent-run-types.js'
import * as F from './agent-runs-fixtures.js'

const FIXED_NOW = 1_800_000_000_000
const ctx = { now: () => FIXED_NOW }

function run(raw: unknown[], state = adapter.createState()) {
  return { records: adapter.normalize(raw, state, ctx), state }
}
function appends(recs: ReturnType<typeof adapter.normalize>) {
  return recs.filter((r): r is Extract<typeof r, { op: 'append' }> => r.op === 'append')
}

describe('cursor-stream-json adapter', () => {
  it('is registered under its wire name', () => {
    expect(getAdapter('cursor-stream-json')).toBe(adapter)
    expect(getAdapter('nope')).toBeNull()
  })

  // ── Fact 2: timestamps ─────────────────────────────────────────────────────
  it('server-stamps every event the vendor left without a timestamp', () => {
    const { records } = run([F.INIT_NO_TS, F.USER_NO_TS, F.ASSISTANT_NO_TS, F.RESULT_NO_TS])
    const evs = appends(records).map((r) => r.event)
    expect(evs.map((e) => e.kind)).toEqual(['init', 'user', 'assistant', 'result'])
    for (const e of evs) expect(e.ts).toBe(FIXED_NOW)
  })

  it('prefers the vendor timestamp when present', () => {
    const { records } = run([F.ASSISTANT_MD])
    expect(appends(records)[0].event.ts).toBe(1_700_000_002_000)
  })

  it('falls back to startedAtMs (a string) when a tool event lacks timestamp_ms', () => {
    const noTs = { ...F.READ_STARTED, timestamp_ms: undefined }
    const { records } = run([noTs])
    expect(appends(records)[0].event.ts).toBe(1_700_000_007_000)
  })

  // ── Fact 1: call_id newline ────────────────────────────────────────────────
  it('splits the embedded newline out of call_id so phases pair', () => {
    const { records } = run([F.SHELL_STARTED, F.SHELL_COMPLETED_OK])
    const started = appends(records)[0].event
    const patch = records.find((r) => r.op === 'patch')!
    expect(started.tool!.callId).toBe('call_AbCdEf123456')
    expect(started.tool!.callId).not.toContain('\n')
    expect(patch).toMatchObject({ op: 'patch', callId: 'call_AbCdEf123456' })
  })

  // ── Tool started/completed ────────────────────────────────────────────────
  it('appends a running tool on started and patches it on completed', () => {
    const { records } = run([F.SHELL_STARTED, F.SHELL_COMPLETED_OK])
    expect(records).toHaveLength(2)
    expect(appends(records)[0].event).toMatchObject({
      kind: 'tool',
      tool: { name: 'shell', label: 'npm test', status: 'running' },
    })
    const patch = records[1] as Extract<(typeof records)[number], { op: 'patch' }>
    expect(patch.patch.tool).toMatchObject({
      status: 'success',
      exitCode: 0,
      output: '5 passing\n',
      endTs: 1_700_000_004_000,
    })
  })

  it('pairs across batch boundaries using carried state', () => {
    const state = adapter.createState()
    const first = adapter.normalize([F.SHELL_STARTED], state, ctx)
    const second = adapter.normalize([F.SHELL_COMPLETED_OK], state, ctx)
    expect(first).toHaveLength(1)
    expect(first[0].op).toBe('append')
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ op: 'patch', callId: 'call_AbCdEf123456' })
  })

  it('appends a complete event when a completion arrives with no matching started', () => {
    // Happens after a server restart drops in-memory adapter state.
    const { records } = run([F.SHELL_COMPLETED_OK])
    expect(records).toHaveLength(1)
    expect(records[0].op).toBe('append')
    expect(appends(records)[0].event.tool).toMatchObject({ status: 'success', exitCode: 0 })
  })

  // ── Fact 3: failures ──────────────────────────────────────────────────────
  it('reads the failure discriminator and keeps exitCode, stderr and command', () => {
    const { records } = run([F.SHELL_STARTED_FAILURE, F.SHELL_COMPLETED_FAILURE])
    const patch = records.find((r) => r.op === 'patch') as any
    expect(patch.patch.tool).toMatchObject({
      status: 'error',
      exitCode: 1,
      output: 'error TS2304: Cannot find name "foo".\n',
    })
  })

  it('marks a nonzero exitCode inside a success body as an error', () => {
    const weird = structuredClone(F.SHELL_COMPLETED_OK) as any
    weird.tool_call.shellToolCall.result.success.exitCode = 2
    const { records } = run([F.SHELL_STARTED, weird])
    const patch = records.find((r) => r.op === 'patch') as any
    expect(patch.patch.tool.status).toBe('error')
    expect(patch.patch.tool.exitCode).toBe(2)
  })

  // ── Fact 4: arg + output projection ───────────────────────────────────────
  it('drops the shell parsing AST from args', () => {
    const { records } = run([F.SHELL_STARTED])
    const args = appends(records)[0].event.tool!.args
    expect(args).toEqual({ command: 'npm test', workingDirectory: '/home/dev/app' })
    expect(JSON.stringify(args)).not.toContain('executableCommands')
  })

  it('drops whole-file before/after content from an edit result, keeping the diff', () => {
    const { records } = run([F.EDIT_COMPLETED])
    const tool = appends(records)[0].event.tool!
    const serialized = JSON.stringify(tool)
    expect(serialized).not.toContain('x'.repeat(100))
    expect(serialized).not.toContain('y'.repeat(100))
    expect(tool.output).toContain('+app.get("/health", h)')
  })

  // ── Fact 5: string numerics ───────────────────────────────────────────────
  it('coerces string linesAdded/linesRemoved to numbers', () => {
    const { records } = run([F.EDIT_COMPLETED])
    const tool = appends(records)[0].event.tool!
    expect(tool.linesAdded).toBe(9)
    expect(tool.linesRemoved).toBe(0)
    expect(typeof tool.linesAdded).toBe('number')
  })

  it('caps oversized output and flags the truncation', () => {
    const big = structuredClone(F.SHELL_COMPLETED_OK) as any
    big.tool_call.shellToolCall.result.success.stdout = 'z'.repeat(MAX_TOOL_OUTPUT_BYTES + 5000)
    const { records } = run([big])
    const tool = appends(records)[0].event.tool!
    expect(tool.output!.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES + 64)
    expect(tool.outputTruncated).toBe(true)
  })

  // ── Labels ────────────────────────────────────────────────────────────────
  it('labels tools by their most identifying arg', () => {
    const { records } = run([F.SHELL_STARTED, F.READ_STARTED, F.GREP_STARTED])
    expect(appends(records).map((r) => [r.event.tool!.name, r.event.tool!.label])).toEqual([
      ['shell', 'npm test'],
      ['read', '/home/dev/app/src/router.ts'],
      ['grep', 'health|router'],
    ])
  })

  // ── Fact 10: thinking ─────────────────────────────────────────────────────
  it('coalesces a thinking delta run into one event at the terminator', () => {
    const { records } = run(F.THINKING_DELTAS)
    const evs = appends(records).map((r) => r.event)
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ kind: 'thinking', text: '**Reading** the router setup' })
    expect(evs[0].ts).toBe(1_700_000_001_000) // first delta's timestamp, not the terminator's
  })

  it('flushes buffered thinking when a different event kind interrupts it', () => {
    const { records } = run([...F.THINKING_DELTAS.slice(0, 2), F.ASSISTANT_MD])
    expect(appends(records).map((r) => r.event.kind)).toEqual(['thinking', 'assistant'])
  })

  it('coalesces a burst that spans two batches into a single event', () => {
    const state = adapter.createState()
    const a = adapter.normalize([F.THINKING_DELTAS[0]], state, ctx)
    const b = adapter.normalize([F.THINKING_DELTAS[1], F.THINKING_DELTAS[2]], state, ctx)
    expect(a).toHaveLength(0) // nothing emitted yet — still buffering
    expect(appends(b).map((r) => r.event.text)).toEqual(['**Reading** the router setup'])
  })

  // ── Narrative + meta ──────────────────────────────────────────────────────
  it('keeps assistant markdown verbatim for the server-side renderer', () => {
    const { records } = run([F.ASSISTANT_MD])
    expect(appends(records)[0].event.text).toBe('## Plan\n\n- read `router.ts`\n- **add** the route')
  })

  it('carries init identity and result usage into meta', () => {
    const { records } = run([F.INIT_NO_TS, F.RESULT_NO_TS])
    const [init, result] = appends(records).map((r) => r.event)
    expect(init.meta).toMatchObject({
      sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      model: 'Auto Cost',
      cwd: '/home/dev/app',
    })
    expect(result.meta).toMatchObject({
      durationMs: 1_491_836,
      inputTokens: 10367,
      outputTokens: 3083,
      isError: false,
    })
  })

  it('emits a result event even when a resumed turn has an empty body', () => {
    const { records } = run([F.RESULT_EMPTY_BODY])
    const ev = appends(records)[0].event
    expect(ev.kind).toBe('result')
    expect(ev.text).toBe('')
    expect(ev.meta).toMatchObject({ durationMs: 4200 })
  })

  it('handles several result events in one run', () => {
    const { records } = run([F.RESULT_NO_TS, F.ASSISTANT_MD, F.RESULT_EMPTY_BODY])
    expect(appends(records).filter((r) => r.event.kind === 'result')).toHaveLength(2)
  })

  // ── Fact 9 + robustness ───────────────────────────────────────────────────
  it('maps connection and retry chatter to kind other, preserving the vendor tags', () => {
    const { records } = run(F.CONNECTION_EVENTS)
    const evs = appends(records).map((r) => r.event)
    expect(evs.every((e) => e.kind === 'other')).toBe(true)
    expect(evs[0].meta).toMatchObject({ vendorType: 'connection', vendorSubtype: 'reconnecting' })
  })

  it('skips malformed lines instead of throwing the batch away', () => {
    const { records } = run([null, 'not an object', 42, {}, { type: 'tool_call', subtype: 'started' }, F.ASSISTANT_MD])
    expect(appends(records).map((r) => r.event.kind)).toEqual(['assistant'])
  })

  it('never emits a tool event without a callId', () => {
    const noCallId = { type: 'tool_call', subtype: 'started', tool_call: { shellToolCall: { args: { command: 'x' } } } }
    const { records } = run([noCallId])
    expect(records).toHaveLength(0)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/agent-runs-cursor-adapter.test.ts`
Expected: FAIL — `Cannot find module '../../src/agent-runs/formats/cursor-stream-json.js'`.

- [ ] **Step 5: Write the adapter**

Create `src/agent-runs/formats/cursor-stream-json.ts`:

```ts
/**
 * cursor-agent `--output-format stream-json` adapter.
 *
 * Every rule here was measured against real transcripts; see the "Data facts"
 * table in docs/superpowers/plans/2026-08-12-agent-runs.md. The short version:
 *
 *  - call_id carries an embedded newline (156/156 tool calls). Split it.
 *  - system/init, user, result and some assistant events carry NO timestamp.
 *    Server-stamp anything without one.
 *  - Failures are `result: { failure }`, a separate discriminator from
 *    `result: { success }` — not a malformed success. Both carry exitCode,
 *    stdout and stderr, and both must keep them.
 *  - Raw is ~10x larger than it needs to be: edit results carry the entire
 *    file before AND after, and shell args carry a full command AST. Both are
 *    dropped here, which is what makes canonical-only storage viable.
 *  - linesAdded/linesRemoved arrive as strings.
 *
 * This module is pure apart from the injected clock.
 */

import {
  MAX_TOOL_OUTPUT_BYTES,
  type AgentEvent,
  type ToolInfo,
  type ToolStatus,
} from '../../shared/agent-run-types.js'
import type { AdapterState, FormatAdapter, NormalizeCtx, PendingRecord } from './types.js'

// ── State ────────────────────────────────────────────────────────────────────

interface CursorState extends AdapterState {
  /** Accumulating thinking deltas, flushed on a terminator or a foreign event. */
  thinkingParts: string[]
  thinkingStartTs: number | null
  /** callIds we have already appended a `running` event for. */
  openCalls: Set<string>
}

function createState(): CursorState {
  return { thinkingParts: [], thinkingStartTs: null, openCalls: new Set() }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/** Coerce a vendor numeric that may arrive as a string (fact 5) or a number. */
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * Fact 1: `call_id` is two ids joined by a newline. Only the first segment is
 * stable across the started/completed pair, so it is the identity we key on.
 */
function normalizeCallId(raw: unknown): string | undefined {
  const s = str(raw)
  if (!s) return undefined
  const first = s.split('\n')[0].trim()
  return first.length > 0 ? first : undefined
}

/** Concatenate the text parts of a vendor `message.content` array. */
function messageText(e: Record<string, unknown>): string {
  const msg = e.message
  if (!isRecord(msg) || !Array.isArray(msg.content)) return ''
  return msg.content
    .map((part) => (isRecord(part) ? (str(part.text) ?? '') : ''))
    .join('')
}

function capOutput(text: string): { output: string; truncated: boolean } {
  if (text.length <= MAX_TOOL_OUTPUT_BYTES) return { output: text, truncated: false }
  return { output: text.slice(0, MAX_TOOL_OUTPUT_BYTES) + '\n… truncated …', truncated: true }
}

// ── Tool projection ──────────────────────────────────────────────────────────

/**
 * Fact 4: keep only display-relevant args. `parsingResult` (a full shell AST)
 * and the various toolCallId echoes are dropped — they are the bulk of the raw
 * payload and nothing renders them.
 */
const ARG_ALLOWLIST: Record<string, readonly string[]> = {
  shell: ['command', 'workingDirectory'],
  read: ['path', 'offset', 'limit'],
  edit: ['path'],
  write: ['path'],
  grep: ['pattern', 'path', 'outputMode', 'caseInsensitive', 'multiline'],
  glob: ['pattern', 'path'],
  ls: ['path'],
  webSearch: ['query'],
  webFetch: ['url'],
}

function projectArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const allow = ARG_ALLOWLIST[toolName]
  const out: Record<string, unknown> = {}
  if (allow) {
    for (const k of allow) if (args[k] !== undefined && args[k] !== '') out[k] = args[k]
    return out
  }
  // Unknown tool: keep scalars only, so a future tool degrades gracefully
  // instead of dragging an arbitrary object graph into storage.
  for (const [k, v] of Object.entries(args)) {
    const t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') out[k] = v
  }
  return out
}

/** Short, scannable one-line description of a tool call. */
function toolLabel(toolName: string, args: Record<string, unknown>): string {
  for (const k of ['command', 'pattern', 'query', 'url']) {
    const v = str(args[k])
    if (v) return v
  }
  for (const k of ['path', 'file_path']) {
    const v = str(args[k])
    if (v) return v
  }
  return JSON.stringify(args).slice(0, 200)
}

/** `shellToolCall` -> `shell`. */
function toolNameFromKey(key: string): string {
  return key.endsWith('ToolCall') ? key.slice(0, -'ToolCall'.length) : key
}

interface ToolResultProjection {
  status: ToolStatus
  exitCode?: number
  output?: string
  outputTruncated?: boolean
  linesAdded?: number
  linesRemoved?: number
}

/**
 * Fact 3: `result` is `{ success }` XOR `{ failure }`. Both bodies carry the
 * same diagnostic fields, so they project identically — only the status and the
 * default differ. Fact 4: whole-file before/after content is never kept.
 */
function projectResult(result: unknown): ToolResultProjection | null {
  if (!isRecord(result)) return null

  const failure = isRecord(result.failure) ? result.failure : null
  const success = isRecord(result.success) ? result.success : null
  const body = failure ?? success
  if (!body) {
    // A result object in neither shape: record the error without inventing detail.
    return { status: 'error', output: JSON.stringify(result).slice(0, 2000) }
  }

  const exitCode = num(body.exitCode)
  // A nonzero exit inside a `success` envelope is still a failed command.
  let status: ToolStatus = failure ? 'error' : 'success'
  if (status === 'success' && exitCode !== undefined && exitCode !== 0) status = 'error'

  // Preference order: real command output, then a diff, then the tool's message.
  // `beforeFullFileContent` / `afterFullFileContent` are deliberately absent.
  const stdout = str(body.stdout) ?? ''
  const stderr = str(body.stderr) ?? ''
  const combined =
    [stdout, stderr].filter((s) => s.length > 0).join('\n') ||
    str(body.diffString) ||
    str(body.content) ||
    str(body.message) ||
    ''

  const { output, truncated } = capOutput(combined)
  const projection: ToolResultProjection = { status }
  if (exitCode !== undefined) projection.exitCode = exitCode
  if (output.length > 0) projection.output = output
  if (truncated) projection.outputTruncated = true
  const added = num(body.linesAdded)
  const removed = num(body.linesRemoved)
  if (added !== undefined) projection.linesAdded = added
  if (removed !== undefined) projection.linesRemoved = removed
  return projection
}

// ── Timestamps (fact 2) ──────────────────────────────────────────────────────

/**
 * Resolve an event's timestamp. Order: the vendor's own `timestamp_ms`, then a
 * tool body's `startedAtMs` (a string, fact 7), then the server clock. Never
 * assume the vendor sent one — four event types routinely do not.
 */
function resolveTs(e: Record<string, unknown>, toolBody: Record<string, unknown> | null, now: () => number): number {
  return num(e.timestamp_ms) ?? (toolBody ? num(toolBody.startedAtMs) : undefined) ?? now()
}

// ── normalize ────────────────────────────────────────────────────────────────

function normalize(raw: unknown[], stateIn: AdapterState, ctx: NormalizeCtx): PendingRecord[] {
  const state = stateIn as CursorState
  const out: PendingRecord[] = []

  const append = (event: Omit<AgentEvent, 'seq'>) => out.push({ op: 'append', event })

  const flushThinking = () => {
    if (state.thinkingParts.length === 0) return
    append({
      kind: 'thinking',
      ts: state.thinkingStartTs ?? ctx.now(),
      text: state.thinkingParts.join(''),
    })
    state.thinkingParts = []
    state.thinkingStartTs = null
  }

  for (const line of raw) {
    if (!isRecord(line)) continue
    const type = str(line.type)
    if (!type) continue
    const subtype = str(line.subtype)

    // Thinking is the only buffered kind; everything else flushes it first so
    // the reasoning node lands before whatever interrupted it.
    if (type === 'thinking') {
      if (subtype === 'delta') {
        const text = str(line.text) ?? ''
        if (state.thinkingStartTs === null) state.thinkingStartTs = resolveTs(line, null, ctx.now)
        state.thinkingParts.push(text)
      } else {
        flushThinking()
      }
      continue
    }

    flushThinking()

    switch (type) {
      case 'system': {
        if (subtype !== 'init') {
          append({ kind: 'other', ts: resolveTs(line, null, ctx.now), meta: { vendorType: type, vendorSubtype: subtype } })
          break
        }
        append({
          kind: 'init',
          ts: resolveTs(line, null, ctx.now),
          meta: {
            sessionId: str(line.session_id),
            model: str(line.model),
            cwd: str(line.cwd),
            permissionMode: str(line.permissionMode),
          },
        })
        break
      }

      case 'user': {
        append({ kind: 'user', ts: resolveTs(line, null, ctx.now), text: messageText(line) })
        break
      }

      case 'assistant': {
        const text = messageText(line)
        // Cursor emits assistant frames with no text alongside tool calls; a
        // node with nothing in it is noise on the timeline.
        if (text.length === 0) break
        append({ kind: 'assistant', ts: resolveTs(line, null, ctx.now), text })
        break
      }

      case 'tool_call': {
        const container = isRecord(line.tool_call) ? line.tool_call : null
        if (!container) break
        const key = Object.keys(container).find((k) => k.endsWith('ToolCall'))
        if (!key) break
        const body = isRecord(container[key]) ? (container[key] as Record<string, unknown>) : null
        if (!body) break

        const callId = normalizeCallId(line.call_id) ?? normalizeCallId(container.toolCallId)
        if (!callId) break // never emit a tool event we cannot correlate

        const toolName = toolNameFromKey(key)
        const rawArgs = isRecord(body.args) ? body.args : {}
        const args = projectArgs(toolName, rawArgs)
        const ts = resolveTs(line, body, ctx.now)

        if (subtype === 'started') {
          state.openCalls.add(callId)
          const tool: ToolInfo = {
            name: toolName,
            callId,
            label: toolLabel(toolName, rawArgs),
            args,
            status: 'running',
          }
          append({ kind: 'tool', ts, tool })
          break
        }

        // completed (or any terminal subtype)
        const projection = projectResult(body.result)
        if (state.openCalls.has(callId)) {
          state.openCalls.delete(callId)
          out.push({
            op: 'patch',
            callId,
            patch: { tool: { ...(projection ?? { status: 'success' }), endTs: ts } as Partial<ToolInfo> as any },
          })
          break
        }

        // No matching `started` — in-memory state was lost (server restart) or
        // the client replayed mid-stream. Append a complete event instead.
        const tool: ToolInfo = {
          name: toolName,
          callId,
          label: toolLabel(toolName, rawArgs),
          args,
          status: 'success',
          ...(projection ?? {}),
          endTs: ts,
        }
        append({ kind: 'tool', ts, tool })
        break
      }

      case 'result': {
        const usage = isRecord(line.usage) ? line.usage : {}
        append({
          kind: 'result',
          ts: resolveTs(line, null, ctx.now),
          text: str(line.result) ?? '',
          meta: {
            isError: line.is_error === true,
            resultSubtype: subtype,
            durationMs: num(line.duration_ms),
            inputTokens: num(usage.inputTokens),
            outputTokens: num(usage.outputTokens),
            sessionId: str(line.session_id),
          },
        })
        break
      }

      default: {
        append({
          kind: 'other',
          ts: resolveTs(line, null, ctx.now),
          meta: { vendorType: type, vendorSubtype: subtype },
        })
      }
    }
  }

  // Deliberately do NOT flush at end of batch: a delta burst that spans two
  // batches must coalesce into one event, so the buffer carries over in state.
  // The terminator or the next foreign event flushes it.
  return out
}

export const cursorStreamJsonAdapter: FormatAdapter = {
  name: 'cursor-stream-json',
  version: 1,
  createState,
  normalize,
}
```

Create `src/agent-runs/formats/index.ts`:

```ts
/**
 * Format-adapter registry.
 *
 * Adding an adapter (Claude Code JSONL is next) is a one-line change here and
 * a new file beside it — by design, neither ingest nor the UI is touched.
 */
import type { FormatAdapter } from './types.js'
import { cursorStreamJsonAdapter } from './cursor-stream-json.js'

const ADAPTERS: readonly FormatAdapter[] = [cursorStreamJsonAdapter]

export function getAdapter(format: string): FormatAdapter | null {
  return ADAPTERS.find((a) => a.name === format) ?? null
}

export function knownFormats(): string[] {
  return ADAPTERS.map((a) => a.name)
}

export type { FormatAdapter, PendingRecord, AdapterState, NormalizeCtx } from './types.js'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/agent-runs-cursor-adapter.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 7: Typecheck**

Run: `npx tsc -p tsconfig.cli.json --noEmit`
Expected: no output.

- [ ] **Step 8: Sanity-run the adapter over the real transcripts — locally, committing nothing**

This is the step that catches a fact the synthetic fixtures got wrong. Write the throwaway script to the scratchpad, **not** the repo.

```bash
SCRATCH=/private/tmp/claude-502/-Users-dabright-Development-external-public-vibedocs/3e414242-4194-44f6-94df-77c84866f655/scratchpad
cat > "$SCRATCH/adapter-smoke.mjs" <<'EOF'
import { readFileSync, readdirSync } from 'fs'
import { cursorStreamJsonAdapter as a } from './dist-cli/agent-runs/formats/cursor-stream-json.js'
const base = process.argv[2]  // path to the local transcript directory
for (const lane of readdirSync(base).filter((d) => !d.startsWith('.'))) {
  const p = `${base}/${lane}/events.ndjson`
  let raw
  try { raw = readFileSync(p, 'utf8') } catch { continue }
  const lines = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const recs = a.normalize(lines, a.createState(), { now: () => 0 })
  const appends = recs.filter((r) => r.op === 'append')
  const kinds = {}
  for (const r of appends) kinds[r.event.kind] = (kinds[r.event.kind] ?? 0) + 1
  const bytes = Buffer.byteLength(recs.map((r) => JSON.stringify(r)).join('\n'))
  const stamped = appends.filter((r) => r.event.ts === 0).length
  const errs = appends.filter((r) => r.event.tool?.status === 'error').length
    + recs.filter((r) => r.op === 'patch' && r.patch.tool?.status === 'error').length
  console.log(
    lane.padEnd(10),
    `raw=${(raw.length / 1048576).toFixed(2)}MB`,
    `canon=${(bytes / 1048576).toFixed(2)}MB`,
    `recs=${recs.length}`,
    `stamped=${stamped}`,
    `toolErrors=${errs}`,
    JSON.stringify(kinds),
  )
}
EOF
npm run build:cli && node "$SCRATCH/adapter-smoke.mjs"
```

Check four things in the output, and fix the adapter if any fails:

1. **No crash on any of the eight lanes.**
2. **`canon` is a small fraction of `raw`** — expect roughly 5.8 MB → under 1 MB for the largest. If it is not, an oversized field is still surviving projection.
3. **`toolErrors` is non-zero** — 37 exist across the lanes. Zero means the `failure` discriminator is still being missed, which is fact 3 regressing.
4. **`stamped` is small but non-zero** (the handful of events with no vendor timestamp). A large number means `timestamp_ms` parsing broke.

Do not commit the script or its output — the lane names and paths are internal.

- [ ] **Step 9: Commit**

```bash
git add src/agent-runs/formats tests/agent-runs-cursor-adapter.test.ts tests/agent-runs-fixtures.ts
git commit -m "feat(agent-runs): cursor-stream-json format adapter

Normalizes cursor-agent stream-json into the canonical event shape. Written
against eight real transcripts; the non-obvious rules:

- call_id carries an embedded newline (156/156 tool calls) — split it or
  started/completed never pair.
- system/init, user, result and some assistant events carry no timestamp at
  all; anything without one is server-stamped.
- failures are 'result: { failure }', a separate discriminator from
  'result: { success }' — both carry exitCode/stdout/stderr and both keep them.
- edit results carry the entire file before AND after, and shell args carry a
  full command AST; both are dropped, which is what makes canonical-only
  storage viable (5.8MB raw -> under 1MB).
- linesAdded/linesRemoved arrive as strings.

Fixtures are synthetic on purpose: real transcripts carry internal issue keys
and paths that must not enter a public repo.

Assisted-by: Claude Opus 5"
```

---

### Task 3: The run store

Owns the two files per run and every identity decision: seq assignment, record numbering, `callId → seq` correlation, atomic meta writes, and batch idempotency. It is also a **path-traversal boundary** — a run id becomes a directory name — so id validation is a security check, not a formatting one.

One design point worth stating, because it is the store's least obvious job: **the store is the authority on tool-call correlation, not the adapter.** The adapter emits `{ op: 'patch', callId }` when it remembers a matching `started`, and a full append when it does not (its in-memory state was lost to a restart). The store resolves `callId` against an index it rebuilds *from disk*, so it can upgrade that fallback append back into a patch. Without this, a server restart mid-run leaves the pre-restart tool node spinning forever while a duplicate completed node appears below it.

**Files:**
- Create: `src/agent-runs/store.ts`
- Create: `tests/agent-runs-store.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `EventRecord`, `RunMeta`, `RunStatus`, `RunLink`, `applyRecords`, `ADAPTER_VERSION` (Task 1); `PendingRecord` (Task 2); `VibedocsError` from `src/errors.js`.
- Produces:
  - `createRunStore(opts: { runsDir: string }): RunStore`
  - `interface RunStore { createRun(input: CreateRunInput): Promise<RunMeta>; getRun(id): Promise<RunMeta | null>; listRuns(): Promise<RunMeta[]>; patchRun(id, patch: PatchRunInput): Promise<RunMeta>; appendRecords(id, pending: PendingRecord[], clientSeq?: number): Promise<AppendResult>; readRecords(id, fromRec: number): Promise<{ records: EventRecord[]; recCount: number }>; readEvents(id): Promise<AgentEvent[]> }`
  - `interface CreateRunInput { id?: string; title: string; description?: string; status?: RunStatus; links?: RunLink[]; format: string; agent?: string; workdir?: string }`
  - `interface PatchRunInput { title?: string; description?: string; status?: RunStatus; links?: RunLink[]; stopRequested?: boolean }`
  - `interface AppendResult { recCount: number; eventCount: number; appended: number; deduped: boolean }`
  - `assertValidRunId(id: string): string`

- [ ] **Step 1: Write the failing store tests**

Create `tests/agent-runs-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { createRunStore, assertValidRunId, type RunStore } from '../src/agent-runs/store.js'
import { applyRecords, ADAPTER_VERSION } from '../src/shared/agent-run-types.js'
import type { PendingRecord } from '../src/agent-runs/formats/types.js'
import { VibedocsError } from '../src/errors.js'

let dir: string
let store: RunStore

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vibedocs-runs-'))
  store = createRunStore({ runsDir: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const base = { title: 'Add health endpoint', format: 'cursor-stream-json' as const }

function appendEvent(kind: string, over: Record<string, unknown> = {}): PendingRecord {
  return { op: 'append', event: { ts: 1000, kind: kind as any, ...over } }
}
function toolStart(callId: string, label = 'npm test'): PendingRecord {
  return {
    op: 'append',
    event: { ts: 1000, kind: 'tool', tool: { name: 'shell', callId, label, args: {}, status: 'running' } },
  }
}

describe('assertValidRunId', () => {
  it('accepts ordinary slugs', () => {
    for (const id of ['abc', 'run-1', 'a_b.c', 'A1', 'x'.repeat(128)]) {
      expect(assertValidRunId(id)).toBe(id)
    }
  })

  it('rejects every traversal and separator form', () => {
    for (const bad of ['..', '.', 'a/b', 'a\\b', '../x', 'a/../b', '', ' ', 'x'.repeat(129), 'a b', 'a:b', '\0']) {
      expect(() => assertValidRunId(bad)).toThrow(VibedocsError)
    }
  })

  it('throws a traversal-coded error for separators specifically', () => {
    try {
      assertValidRunId('../escape')
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as VibedocsError).code).toBe('traversal')
    }
  })
})

describe('createRunStore', () => {
  it('creates a run, generates an id, and seeds meta', async () => {
    const meta = await store.createRun(base)
    expect(meta.id).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(meta).toMatchObject({
      title: 'Add health endpoint',
      status: 'running',
      links: [],
      format: 'cursor-stream-json',
      eventCount: 0,
      recCount: 0,
      adapterVersion: ADAPTER_VERSION,
    })
    expect(meta.createdAt).toBeGreaterThan(0)
  })

  it('honours a caller-supplied id and rejects a traversing one', async () => {
    const meta = await store.createRun({ ...base, id: 'my-run' })
    expect(meta.id).toBe('my-run')
    await expect(store.createRun({ ...base, id: '../evil' })).rejects.toThrow(VibedocsError)
  })

  it('is idempotent on re-registering the same id, preserving events', async () => {
    const first = await store.createRun({ ...base, id: 'r1' })
    await store.appendRecords('r1', [appendEvent('user', { text: 'hi' })])
    const second = await store.createRun({ ...base, id: 'r1', title: 'Renamed' })
    expect(second.id).toBe('r1')
    expect(second.title).toBe('Renamed')       // metadata updates
    expect(second.createdAt).toBe(first.createdAt) // identity does not
    expect(second.eventCount).toBe(1)          // events survive re-registration
  })

  it('returns null for an unknown run rather than throwing', async () => {
    expect(await store.getRun('nope')).toBeNull()
  })

  it('lists runs newest-updated first', async () => {
    await store.createRun({ ...base, id: 'a' })
    await store.createRun({ ...base, id: 'b' })
    await store.patchRun('a', { status: 'done' })
    expect((await store.listRuns()).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('ignores non-directory and malformed entries when listing', async () => {
    await store.createRun({ ...base, id: 'good' })
    await writeFile(path.join(dir, 'stray.txt'), 'junk')
    const runs = await store.listRuns()
    expect(runs.map((r) => r.id)).toEqual(['good'])
  })
})

describe('appendRecords', () => {
  it('assigns 1-based monotonic seq and counts records', async () => {
    await store.createRun({ ...base, id: 'r' })
    const res = await store.appendRecords('r', [appendEvent('user', { text: 'a' }), appendEvent('assistant', { text: 'b' })])
    expect(res).toMatchObject({ appended: 2, eventCount: 2, recCount: 2, deduped: false })
    const events = await store.readEvents('r')
    expect(events.map((e) => e.seq)).toEqual([1, 2])
  })

  it('resolves a patch by callId to the right seq', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [appendEvent('user'), toolStart('c1')])
    await store.appendRecords('r', [
      { op: 'patch', callId: 'c1', patch: { tool: { status: 'success', exitCode: 0 } as any } },
    ])
    const events = await store.readEvents('r')
    expect(events).toHaveLength(2)
    expect(events[1].tool).toMatchObject({ callId: 'c1', label: 'npm test', status: 'success', exitCode: 0 })
  })

  it('writes the patch line with a resolved numeric seq, not a callId', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [toolStart('c1')])
    await store.appendRecords('r', [{ op: 'patch', callId: 'c1', patch: { tool: { status: 'success' } as any } }])
    const raw = await readFile(path.join(dir, 'r', 'events.ndjson'), 'utf8')
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines[1]).toEqual({ op: 'patch', seq: 1, patch: { tool: { status: 'success' } } })
    expect(JSON.stringify(lines[1])).not.toContain('callId')
  })

  it('drops a patch whose callId was never seen', async () => {
    await store.createRun({ ...base, id: 'r' })
    const res = await store.appendRecords('r', [{ op: 'patch', callId: 'ghost', patch: { text: 'x' } }])
    expect(res.appended).toBe(0)
    expect(res.recCount).toBe(0)
  })

  // The restart case — the store is the authority on correlation.
  it('upgrades a duplicate tool append into a patch when the callId is already known', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [toolStart('c1')])

    // Simulate a restart: a brand-new store instance, no in-memory index.
    const fresh = createRunStore({ runsDir: dir })
    await fresh.appendRecords('r', [
      {
        op: 'append',
        event: {
          ts: 2000,
          kind: 'tool',
          tool: { name: 'shell', callId: 'c1', label: 'npm test', args: {}, status: 'success', exitCode: 0, endTs: 2000 },
        },
      },
    ])

    const events = await fresh.readEvents('r')
    expect(events).toHaveLength(1)            // no duplicate node
    expect(events[0].tool).toMatchObject({ status: 'success', exitCode: 0 })  // and it is no longer running
  })

  it('rebuilds the callId index from disk when the store is recreated', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [appendEvent('user'), toolStart('c1')])
    const fresh = createRunStore({ runsDir: dir })
    await fresh.appendRecords('r', [{ op: 'patch', callId: 'c1', patch: { tool: { status: 'error' } as any } }])
    const events = await fresh.readEvents('r')
    expect(events[1].tool!.status).toBe('error')
  })

  it('is idempotent on a replayed clientSeq and does not double-write', async () => {
    await store.createRun({ ...base, id: 'r' })
    const first = await store.appendRecords('r', [appendEvent('user', { text: 'a' })], 7)
    const replay = await store.appendRecords('r', [appendEvent('user', { text: 'a' })], 7)
    expect(first.deduped).toBe(false)
    expect(replay).toMatchObject({ deduped: true, appended: 0, eventCount: 1, recCount: 1 })
    expect(await store.readEvents('r')).toHaveLength(1)
  })

  it('accepts a higher clientSeq after a dedupe', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [appendEvent('user')], 1)
    await store.appendRecords('r', [appendEvent('user')], 1)
    const next = await store.appendRecords('r', [appendEvent('assistant')], 2)
    expect(next).toMatchObject({ deduped: false, eventCount: 2 })
  })

  it('appends without a clientSeq every time (unbatched clients are not deduped)', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [appendEvent('user')])
    await store.appendRecords('r', [appendEvent('user')])
    expect(await store.readEvents('r')).toHaveLength(2)
  })

  it('throws not-found for an unknown run', async () => {
    await expect(store.appendRecords('ghost', [appendEvent('user')])).rejects.toThrow(VibedocsError)
  })

  it('bumps updatedAt and eventCount in meta.json on disk', async () => {
    const created = await store.createRun({ ...base, id: 'r' })
    await new Promise((r) => setTimeout(r, 2))
    await store.appendRecords('r', [appendEvent('user')])
    const onDisk = JSON.parse(await readFile(path.join(dir, 'r', 'meta.json'), 'utf8'))
    expect(onDisk.eventCount).toBe(1)
    expect(onDisk.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  })
})

describe('readRecords paging', () => {
  it('pages by record position and reports the total', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [appendEvent('user'), toolStart('c1')])
    await store.appendRecords('r', [{ op: 'patch', callId: 'c1', patch: { tool: { status: 'success' } as any } }])

    const all = await store.readRecords('r', 0)
    expect(all.records).toHaveLength(3)
    expect(all.recCount).toBe(3)

    const tail = await store.readRecords('r', 2)
    expect(tail.records).toHaveLength(1)
    expect(tail.records[0]).toMatchObject({ op: 'patch', seq: 2 })
    expect(tail.recCount).toBe(3)
  })

  it('folds a tail page onto a prior fold identically to a full read', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [toolStart('c1')])
    const page1 = await store.readRecords('r', 0)
    await store.appendRecords('r', [{ op: 'patch', callId: 'c1', patch: { tool: { status: 'success' } as any } }])
    const page2 = await store.readRecords('r', page1.recCount)

    const incremental = applyRecords(applyRecords([], page1.records), page2.records)
    expect(incremental).toEqual(await store.readEvents('r'))
  })

  it('returns an empty page for a run with no events', async () => {
    await store.createRun({ ...base, id: 'r' })
    expect(await store.readRecords('r', 0)).toEqual({ records: [], recCount: 0 })
    expect(await store.readEvents('r')).toEqual([])
  })

  it('skips a corrupt line rather than failing the whole read', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [appendEvent('user', { text: 'ok' })])
    await writeFile(path.join(dir, 'r', 'events.ndjson'), '{"op":"append","event":{"seq":1,"ts":1,"kind":"user"}}\nNOT JSON\n', 'utf8')
    const { records } = await store.readRecords('r', 0)
    expect(records).toHaveLength(1)
  })
})

describe('patchRun', () => {
  it('applies a partial update and leaves other fields alone', async () => {
    await store.createRun({ ...base, id: 'r', description: 'keep me' })
    const patched = await store.patchRun('r', { status: 'waiting' })
    expect(patched).toMatchObject({ status: 'waiting', description: 'keep me', title: 'Add health endpoint' })
  })

  it('replaces links wholesale when supplied', async () => {
    await store.createRun({ ...base, id: 'r', links: [{ label: 'old', url: 'https://example.com/a', kind: 'other' }] })
    const patched = await store.patchRun('r', { links: [{ label: 'PR 3', url: 'https://example.com/pr/3', kind: 'pr' }] })
    expect(patched.links).toEqual([{ label: 'PR 3', url: 'https://example.com/pr/3', kind: 'pr' }])
  })

  it('throws not-found for an unknown run', async () => {
    await expect(store.patchRun('ghost', { status: 'done' })).rejects.toThrow(VibedocsError)
  })

  it('never leaves a truncated meta.json behind (atomic rename)', async () => {
    await store.createRun({ ...base, id: 'r' })
    await Promise.all([
      store.patchRun('r', { status: 'done' }),
      store.patchRun('r', { status: 'failed' }),
      store.patchRun('r', { status: 'waiting' }),
    ])
    const onDisk = JSON.parse(await readFile(path.join(dir, 'r', 'meta.json'), 'utf8'))
    expect(['done', 'failed', 'waiting']).toContain(onDisk.status)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/agent-runs-store.test.ts`
Expected: FAIL — `Cannot find module '../../src/agent-runs/store.js'`.

- [ ] **Step 3: Write the store**

Create `src/agent-runs/store.ts`:

```ts
/**
 * Agent-run storage: two files per run under a configurable root.
 *
 *   <runsDir>/<runId>/meta.json      identity, status, links, counters
 *   <runsDir>/<runId>/events.ndjson  append-only EventRecord log, one per line
 *
 * Files on disk, no database — consistent with the rest of VibeDocs.
 *
 * The store owns every identity decision:
 *  - seq assignment (1-based, monotonic per run)
 *  - record numbering (line position; the paging key)
 *  - callId -> seq correlation for tool patches
 *  - batch idempotency via the client's batch sequence
 *
 * Correlation deserves a note. An adapter emits a patch keyed by callId when it
 * remembers the matching `started`, and a full append when it does not — which
 * is what happens after a restart drops its in-memory state. The store rebuilds
 * its callId index *from disk*, so it can upgrade that fallback append back
 * into a patch. Without that, a restart mid-run leaves the pre-restart tool node
 * spinning forever with a duplicate completed node underneath it.
 */

import { mkdir, readFile, writeFile, rename, appendFile, readdir, stat } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import {
  applyRecords,
  ADAPTER_VERSION,
  type AgentEvent,
  type EventRecord,
  type RunLink,
  type RunMeta,
  type RunStatus,
} from '../shared/agent-run-types.js'
import type { PendingRecord } from './formats/types.js'
import { VibedocsError } from '../errors.js'

const META_FILE = 'meta.json'
const EVENTS_FILE = 'events.ndjson'
const MAX_RUN_ID_LENGTH = 128

/**
 * Validate a run id before it becomes a directory name.
 *
 * This is a security boundary, not a formatting preference: the id is joined
 * onto runsDir, so anything containing a separator or a dot-segment could
 * escape the sandbox. The allowlist is deliberately narrow — letters, digits,
 * dot, underscore, hyphen — and `.`/`..` are rejected outright.
 */
export function assertValidRunId(id: string): string {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_RUN_ID_LENGTH) {
    throw new VibedocsError('invalid', 'Run id must be 1-128 characters')
  }
  if (id.includes('/') || id.includes('\\') || id === '.' || id === '..') {
    throw new VibedocsError('traversal', 'Run id may not contain path separators')
  }
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new VibedocsError('invalid', 'Run id may only contain letters, digits, dot, underscore and hyphen')
  }
  return id
}

export interface CreateRunInput {
  id?: string
  title: string
  description?: string
  status?: RunStatus
  links?: RunLink[]
  format: string
  agent?: string
  workdir?: string
}

export interface PatchRunInput {
  title?: string
  description?: string
  status?: RunStatus
  links?: RunLink[]
  stopRequested?: boolean
}

export interface AppendResult {
  recCount: number
  eventCount: number
  /** Number of records actually written this call. */
  appended: number
  /** True when the batch was recognised as a replay and skipped entirely. */
  deduped: boolean
}

export interface RunStore {
  createRun(input: CreateRunInput): Promise<RunMeta>
  getRun(id: string): Promise<RunMeta | null>
  listRuns(): Promise<RunMeta[]>
  patchRun(id: string, patch: PatchRunInput): Promise<RunMeta>
  appendRecords(id: string, pending: PendingRecord[], clientSeq?: number): Promise<AppendResult>
  readRecords(id: string, fromRec: number): Promise<{ records: EventRecord[]; recCount: number }>
  readEvents(id: string): Promise<AgentEvent[]>
}

export function createRunStore(opts: { runsDir: string }): RunStore {
  const { runsDir } = opts

  /** callId -> seq, per run. Rebuilt from disk on first use after a restart. */
  const callIndexes = new Map<string, Map<string, number>>()

  /**
   * Serialize writes per run. Two batches arriving concurrently would otherwise
   * interleave seq assignment against a stale meta read.
   */
  const writeChains = new Map<string, Promise<unknown>>()

  function runDir(id: string): string {
    return path.join(runsDir, assertValidRunId(id))
  }

  async function readMeta(id: string): Promise<RunMeta | null> {
    try {
      const raw = await readFile(path.join(runDir(id), META_FILE), 'utf8')
      return JSON.parse(raw) as RunMeta
    } catch {
      return null
    }
  }

  async function requireMeta(id: string): Promise<RunMeta> {
    const meta = await readMeta(id)
    if (!meta) throw new VibedocsError('not-found', `Run not found: ${id}`)
    return meta
  }

  /** Write meta atomically: temp file then rename, so a reader never sees a half-written file. */
  async function writeMeta(meta: RunMeta): Promise<void> {
    const dir = runDir(meta.id)
    // Unique temp name so concurrent writers cannot clobber each other's temp.
    const tmp = path.join(dir, `.${META_FILE}.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8')
    await rename(tmp, path.join(dir, META_FILE))
  }

  function parseRecordLine(line: string): EventRecord | null {
    try {
      const parsed = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object') return null
      if (parsed.op === 'append' && parsed.event && typeof parsed.event.seq === 'number') return parsed
      if (parsed.op === 'patch' && typeof parsed.seq === 'number') return parsed
      return null
    } catch {
      return null
    }
  }

  async function readAllRecords(id: string): Promise<EventRecord[]> {
    let raw: string
    try {
      raw = await readFile(path.join(runDir(id), EVENTS_FILE), 'utf8')
    } catch {
      return []
    }
    const out: EventRecord[] = []
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      const rec = parseRecordLine(line)
      if (rec) out.push(rec)
    }
    return out
  }

  /** Rebuild callId -> seq from the log. Called once per run per process. */
  async function getCallIndex(id: string): Promise<Map<string, number>> {
    const cached = callIndexes.get(id)
    if (cached) return cached
    const index = new Map<string, number>()
    for (const rec of await readAllRecords(id)) {
      if (rec.op === 'append' && rec.event.kind === 'tool' && rec.event.tool?.callId) {
        index.set(rec.event.tool.callId, rec.event.seq)
      }
    }
    callIndexes.set(id, index)
    return index
  }

  /** Run `fn` after any in-flight write for this run has settled. */
  function serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prior = writeChains.get(id) ?? Promise.resolve()
    const next = prior.then(fn, fn)
    // Keep the chain alive but never let a rejection poison the next caller.
    writeChains.set(id, next.catch(() => undefined))
    return next
  }

  return {
    async createRun(input) {
      const id = input.id !== undefined ? assertValidRunId(input.id) : randomUUID()
      const dir = path.join(runsDir, id)
      await mkdir(dir, { recursive: true })

      const now = Date.now()
      const existing = await readMeta(id)

      // Re-registering an existing id updates its metadata but never its
      // identity or its events — a client restarting a lane must not lose them.
      const meta: RunMeta = {
        id,
        title: input.title,
        description: input.description ?? existing?.description,
        status: input.status ?? existing?.status ?? 'running',
        links: input.links ?? existing?.links ?? [],
        format: input.format,
        agent: input.agent ?? existing?.agent,
        workdir: input.workdir ?? existing?.workdir,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        eventCount: existing?.eventCount ?? 0,
        recCount: existing?.recCount ?? 0,
        adapterVersion: ADAPTER_VERSION,
        lastClientSeq: existing?.lastClientSeq,
        stopRequested: existing?.stopRequested,
      }
      await writeMeta(meta)
      return meta
    },

    getRun(id) {
      return readMeta(id)
    },

    async listRuns() {
      let entries: string[]
      try {
        entries = await readdir(runsDir)
      } catch {
        return []
      }
      const metas: RunMeta[] = []
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        try {
          const s = await stat(path.join(runsDir, entry))
          if (!s.isDirectory()) continue
        } catch {
          continue
        }
        const meta = await readMeta(entry).catch(() => null)
        if (meta) metas.push(meta)
      }
      return metas.sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async patchRun(id, patch) {
      return serialize(id, async () => {
        const meta = await requireMeta(id)
        const next: RunMeta = {
          ...meta,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.links !== undefined ? { links: patch.links } : {}),
          ...(patch.stopRequested !== undefined ? { stopRequested: patch.stopRequested } : {}),
          updatedAt: Date.now(),
        }
        await writeMeta(next)
        return next
      })
    },

    async appendRecords(id, pending, clientSeq) {
      return serialize(id, async () => {
        const meta = await requireMeta(id)

        // Batch idempotency: a client retrying the same batch must not double-write.
        if (clientSeq !== undefined && meta.lastClientSeq !== undefined && clientSeq <= meta.lastClientSeq) {
          return { recCount: meta.recCount, eventCount: meta.eventCount, appended: 0, deduped: true }
        }

        const index = await getCallIndex(id)
        const lines: string[] = []
        let seq = meta.eventCount
        let recCount = meta.recCount

        for (const rec of pending) {
          if (rec.op === 'patch') {
            const target = index.get(rec.callId)
            // A patch we cannot correlate is dropped: without a seq it has no
            // meaning, and inventing one would corrupt an unrelated event.
            if (target === undefined) continue
            lines.push(JSON.stringify({ op: 'patch', seq: target, patch: rec.patch }))
            recCount += 1
            continue
          }

          const callId = rec.event.kind === 'tool' ? rec.event.tool?.callId : undefined
          const known = callId ? index.get(callId) : undefined
          if (known !== undefined) {
            // The adapter lost its state and re-sent a completed tool call as a
            // fresh append. We already have the node — patch it instead, or the
            // original stays 'running' forever beside a duplicate.
            const { name: _n, callId: _c, label: _l, args: _a, ...changed } = rec.event.tool!
            lines.push(JSON.stringify({ op: 'patch', seq: known, patch: { tool: changed } }))
            recCount += 1
            continue
          }

          seq += 1
          const event: AgentEvent = { ...rec.event, seq }
          lines.push(JSON.stringify({ op: 'append', event }))
          recCount += 1
          if (callId) index.set(callId, seq)
        }

        if (lines.length > 0) {
          await appendFile(path.join(runDir(id), EVENTS_FILE), lines.join('\n') + '\n', 'utf8')
        }

        const next: RunMeta = {
          ...meta,
          eventCount: seq,
          recCount,
          updatedAt: Date.now(),
          ...(clientSeq !== undefined ? { lastClientSeq: clientSeq } : {}),
        }
        await writeMeta(next)

        return { recCount, eventCount: seq, appended: lines.length, deduped: false }
      })
    },

    async readRecords(id, fromRec) {
      const all = await readAllRecords(id)
      const from = Number.isFinite(fromRec) && fromRec > 0 ? Math.floor(fromRec) : 0
      return { records: all.slice(from), recCount: all.length }
    },

    async readEvents(id) {
      return applyRecords([], await readAllRecords(id))
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/agent-runs-store.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc -p tsconfig.cli.json --noEmit`
Expected: no output.

```bash
git add src/agent-runs/store.ts tests/agent-runs-store.test.ts
./scripts/check-public-safe.sh   # gate: must exit 0
git commit -m "feat(agent-runs): file-backed run store

meta.json + events.ndjson per run, no database. The store owns seq assignment,
record numbering, callId->seq correlation and batch idempotency.

Run ids become directory names, so assertValidRunId is a traversal boundary
with a narrow allowlist, not a formatting check.

Correlation lives here rather than in the adapter: the callId index is rebuilt
from disk, so a completed tool call that arrives as a fresh append after a
restart gets upgraded back into a patch. Otherwise the pre-restart node spins
forever beside a duplicate.

Assisted-by: Claude Opus 5"
```

---

### Task 4: Config, enablement, and the client config shape

The feature is **off by default**. An upstream user who never runs agents should see no extra nav and no extra endpoints. Linkify rules live in a JSON file outside the repo, which is what keeps every issue-tracker and repo URL out of committed source.

**Files:**
- Create: `src/shared/agent-runs-config-types.ts`
- Create: `src/agent-runs/config.ts`
- Create: `tests/agent-runs-config.test.ts`

**Interfaces:**
- Consumes: `LinkKind` (Task 1).
- Produces:
  - `interface LinkifyRule { pattern: string; url: string; kind: LinkKind; flags?: string }`
  - `interface AgentRunsClientConfig { linkify: LinkifyRule[]; editorScheme: string | null }`
  - `interface AgentRunsEnvConfig { enabled: boolean; runsDir: string; token: string | null }`
  - `parseAgentRunsEnv(env, home): AgentRunsEnvConfig`
  - `loadAgentRunsClientConfig(runsDir): Promise<AgentRunsClientConfig>`
  - `compileLinkifyRules(rules): CompiledLinkifyRule[]`, `MAX_LINKIFY_RULES`, `isSafeUrlTemplate(url)`

- [ ] **Step 1: Write the failing config tests**

Create `tests/agent-runs-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { parseAgentRunsEnv, loadAgentRunsClientConfig, compileLinkifyRules } from '../src/agent-runs/config.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'vibedocs-cfg-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

/** The loader reads <dirname(runsDir)>/agent-runs.json, so point runsDir one level down. */
function runsDirIn(base: string) { return path.join(base, 'runs') }

describe('parseAgentRunsEnv', () => {
  it('is disabled by default so upstream users get no extra surface', () => {
    const cfg = parseAgentRunsEnv({}, '/home/dev')
    expect(cfg.enabled).toBe(false)
    expect(cfg.token).toBeNull()
  })

  it('accepts the same truthy spellings as the rest of vibedocs', () => {
    for (const v of ['true', '1', 'yes', 'on', 'TRUE', ' On ']) {
      expect(parseAgentRunsEnv({ VIBEDOCS_RUNS_ENABLED: v }, '/home/dev').enabled).toBe(true)
    }
    for (const v of ['false', '0', 'no', '', 'maybe']) {
      expect(parseAgentRunsEnv({ VIBEDOCS_RUNS_ENABLED: v }, '/home/dev').enabled).toBe(false)
    }
  })

  it('defaults the runs dir under the home directory', () => {
    const cfg = parseAgentRunsEnv({ VIBEDOCS_RUNS_ENABLED: 'true' }, '/home/dev')
    expect(cfg.runsDir).toBe(path.join('/home/dev', '.vibedocs', 'runs'))
  })

  it('honours an explicit runs dir, resolved to an absolute path', () => {
    const cfg = parseAgentRunsEnv({ VIBEDOCS_RUNS_DIR: '/srv/runs' }, '/home/dev')
    expect(cfg.runsDir).toBe('/srv/runs')
    expect(path.isAbsolute(cfg.runsDir)).toBe(true)
  })

  it('treats a blank token as unset', () => {
    expect(parseAgentRunsEnv({ VIBEDOCS_RUNS_TOKEN: '   ' }, '/home/dev').token).toBeNull()
    expect(parseAgentRunsEnv({ VIBEDOCS_RUNS_TOKEN: 's3cret' }, '/home/dev').token).toBe('s3cret')
  })
})

describe('loadAgentRunsClientConfig', () => {
  it('returns empty config when the file is absent', async () => {
    expect(await loadAgentRunsClientConfig(runsDirIn(dir))).toEqual({ linkify: [], editorScheme: null })
  })

  it('reads linkify rules and the editor scheme', async () => {
    await writeFile(path.join(dir, 'agent-runs.json'), JSON.stringify({
      linkify: [{ pattern: '\\b([A-Z]+-\\d+)\\b', url: 'https://tracker.example.com/browse/$1', kind: 'issue' }],
      editorScheme: 'editor://file',
    }))
    const cfg = await loadAgentRunsClientConfig(runsDirIn(dir))
    expect(cfg.editorScheme).toBe('editor://file')
    expect(cfg.linkify).toHaveLength(1)
    expect(cfg.linkify[0].kind).toBe('issue')
  })

  it('degrades to empty config on malformed JSON rather than crashing the server', async () => {
    await writeFile(path.join(dir, 'agent-runs.json'), '{ not json')
    expect(await loadAgentRunsClientConfig(runsDirIn(dir))).toEqual({ linkify: [], editorScheme: null })
  })

  it('drops unusable rules instead of accepting them', async () => {
    await writeFile(path.join(dir, 'agent-runs.json'), JSON.stringify({
      linkify: [
        { pattern: '(', url: 'https://x.example.com/$1', kind: 'issue' },    // unparseable regex
        { pattern: 'ok', url: 'javascript:alert(1)', kind: 'issue' },         // unsafe scheme
        { pattern: 'ok2', kind: 'issue' },                                    // no url
        { pattern: 'good', url: 'https://x.example.com/$1', kind: 'weird' },  // bad kind -> 'other'
      ],
    }))
    const cfg = await loadAgentRunsClientConfig(runsDirIn(dir))
    expect(cfg.linkify).toHaveLength(1)
    expect(cfg.linkify[0]).toMatchObject({ pattern: 'good', kind: 'other' })
  })

  it('rejects a dangerous editor scheme', async () => {
    await writeFile(path.join(dir, 'agent-runs.json'), JSON.stringify({ editorScheme: 'javascript:x' }))
    expect((await loadAgentRunsClientConfig(runsDirIn(dir))).editorScheme).toBeNull()
  })

  it('caps the rule count so a huge config cannot stall linkification', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ pattern: `p${i}`, url: `https://x.example.com/${i}`, kind: 'other' }))
    await writeFile(path.join(dir, 'agent-runs.json'), JSON.stringify({ linkify: many }))
    expect((await loadAgentRunsClientConfig(runsDirIn(dir))).linkify.length).toBeLessThanOrEqual(64)
  })
})

describe('compileLinkifyRules', () => {
  it('compiles patterns to global regexes', () => {
    const compiled = compileLinkifyRules([{ pattern: 'A-\\d+', url: 'https://x.example.com/$1', kind: 'issue' }])
    expect(compiled).toHaveLength(1)
    expect(compiled[0].regex.global).toBe(true)
  })

  it('skips an uncompilable pattern rather than throwing', () => {
    expect(compileLinkifyRules([{ pattern: '(', url: 'https://x.example.com', kind: 'other' }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/agent-runs-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the shared config types**

Create `src/shared/agent-runs-config-types.ts`:

```ts
/**
 * Agent Runs client configuration — shared with the frontend so it can linkify
 * transcript text without a second source of truth.
 *
 * Nothing vendor-specific ever enters this repo: the operator's issue-tracker
 * and repository URLs live in ~/.vibedocs/agent-runs.json on their machine.
 */
import type { LinkKind } from './agent-run-types.js'

export interface LinkifyRule {
  /** JS regex source. Capture groups substitute into `url` as $1, $2, … */
  pattern: string
  /** URL template, e.g. 'https://tracker.example.com/browse/$1'. */
  url: string
  /** Selects the lucide icon shown beside the link. */
  kind: LinkKind
  /** Extra regex flags. 'g' is always applied. */
  flags?: string
}

export interface AgentRunsClientConfig {
  linkify: LinkifyRule[]
  /** e.g. 'editor://file'. Null disables file-path links. */
  editorScheme: string | null
}

export const EMPTY_AGENT_RUNS_CLIENT_CONFIG: AgentRunsClientConfig = { linkify: [], editorScheme: null }

/** Bound on rule count — linkify runs per rendered row. */
export const MAX_LINKIFY_RULES = 64

const DANGEROUS_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:']

/** A config value must never be able to introduce an executable URL scheme. */
export function isSafeUrlTemplate(url: string): boolean {
  const lowered = url.trim().toLowerCase()
  return !DANGEROUS_SCHEMES.some((s) => lowered.startsWith(s))
}
```

- [ ] **Step 4: Write the config loader**

Create `src/agent-runs/config.ts`:

```ts
/**
 * Agent Runs configuration — two halves, deliberately separate.
 *
 *   env  (parseAgentRunsEnv)          enablement, storage location, ingest token
 *   file (loadAgentRunsClientConfig)  linkify rules + editor scheme, handed to the browser
 *
 * The feature is OFF unless VIBEDOCS_RUNS_ENABLED is truthy, so an upstream user
 * who never dispatches an agent gets no extra nav and no extra endpoints.
 */

import { readFile } from 'fs/promises'
import path from 'path'
import {
  EMPTY_AGENT_RUNS_CLIENT_CONFIG,
  MAX_LINKIFY_RULES,
  isSafeUrlTemplate,
  type AgentRunsClientConfig,
  type LinkifyRule,
} from '../shared/agent-runs-config-types.js'
import type { LinkKind } from '../shared/agent-run-types.js'

export const CONFIG_FILENAME = 'agent-runs.json'

const TRUTHY = new Set(['true', '1', 'yes', 'on'])
const VALID_KINDS: readonly LinkKind[] = ['issue', 'pr', 'ci', 'other']

function isTruthy(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.toLowerCase().trim())
}

export interface AgentRunsEnvConfig {
  enabled: boolean
  runsDir: string
  token: string | null
}

export function parseAgentRunsEnv(
  env: Record<string, string | undefined>,
  home: string,
): AgentRunsEnvConfig {
  const explicit = env.VIBEDOCS_RUNS_DIR?.trim()
  const runsDir = explicit ? path.resolve(explicit) : path.join(home, '.vibedocs', 'runs')
  const tokenRaw = env.VIBEDOCS_RUNS_TOKEN
  const token = tokenRaw && tokenRaw.trim().length > 0 ? tokenRaw : null
  return { enabled: isTruthy(env.VIBEDOCS_RUNS_ENABLED), runsDir, token }
}

/** Keep only rules that are complete, compilable, and not a dangerous scheme. */
function sanitizeRules(input: unknown): LinkifyRule[] {
  if (!Array.isArray(input)) return []
  const out: LinkifyRule[] = []
  for (const raw of input) {
    if (out.length >= MAX_LINKIFY_RULES) break
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const pattern = typeof r.pattern === 'string' ? r.pattern : null
    const url = typeof r.url === 'string' ? r.url : null
    if (!pattern || !url) continue
    if (!isSafeUrlTemplate(url)) continue
    try {
      new RegExp(pattern) // reject an unparseable pattern at load, not per row
    } catch {
      continue
    }
    const kindRaw = typeof r.kind === 'string' ? (r.kind as LinkKind) : 'other'
    const kind = VALID_KINDS.includes(kindRaw) ? kindRaw : 'other'
    const flags = typeof r.flags === 'string' ? r.flags : undefined
    out.push({ pattern, url, kind, ...(flags ? { flags } : {}) })
  }
  return out
}

/**
 * Read <runsDir>/../agent-runs.json. Any failure — missing, unreadable,
 * malformed — degrades to empty config. A broken config file must never stop
 * the server from starting.
 */
export async function loadAgentRunsClientConfig(runsDir: string): Promise<AgentRunsClientConfig> {
  const file = path.join(path.dirname(runsDir), CONFIG_FILENAME)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return { ...EMPTY_AGENT_RUNS_CLIENT_CONFIG }
  }
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_AGENT_RUNS_CLIENT_CONFIG }
  const obj = parsed as Record<string, unknown>

  const schemeRaw = typeof obj.editorScheme === 'string' ? obj.editorScheme.trim() : ''
  const editorScheme = schemeRaw.length > 0 && isSafeUrlTemplate(schemeRaw) ? schemeRaw : null

  return { linkify: sanitizeRules(obj.linkify), editorScheme }
}

export interface CompiledLinkifyRule {
  regex: RegExp
  url: string
  kind: LinkKind
}

/** Compile once at load; linkify runs per rendered row and must not recompile. */
export function compileLinkifyRules(rules: readonly LinkifyRule[]): CompiledLinkifyRule[] {
  const out: CompiledLinkifyRule[] = []
  for (const rule of rules) {
    const flags = new Set(['g', ...(rule.flags ?? '')])
    try {
      out.push({ regex: new RegExp(rule.pattern, [...flags].join('')), url: rule.url, kind: rule.kind })
    } catch {
      continue
    }
  }
  return out
}
```

- [ ] **Step 5: Run the tests, typecheck, commit**

Run: `npx vitest run tests/agent-runs-config.test.ts` → PASS, 13 tests.
Run: `npx tsc -p tsconfig.cli.json --noEmit` → no output.

```bash
git add src/shared/agent-runs-config-types.ts src/agent-runs/config.ts tests/agent-runs-config.test.ts
./scripts/check-public-safe.sh   # gate: must exit 0
git commit -m "feat(agent-runs): env + file configuration, disabled by default

VIBEDOCS_RUNS_ENABLED gates the whole feature so an upstream user who never
dispatches an agent gets no extra nav and no extra endpoints. Linkify rules and
the editor scheme live in ~/.vibedocs/agent-runs.json, which keeps every
issue-tracker and repository URL out of committed source.

A malformed config degrades to empty rather than failing startup; rules with an
uncompilable pattern or an executable URL scheme are dropped at load.

Assisted-by: Claude Opus 5"
```

---

### Task 5: The auth split

Two write paths, two threat models, per the decision table. The pushing client is a process holding a shared secret; the browser is a same-origin operator that has no secret and must never be given one.

**Files:**
- Create: `src/bearer-auth.ts`
- Create: `src/agent-runs/auth.ts`
- Create: `tests/agent-runs-auth.test.ts`
- Modify: `src/upload-auth.ts:1` (drop the `timingSafeEqual` import) and `src/upload-auth.ts:88-99` (delegate)

**Interfaces:**
- Consumes: `AgentRunsEnvConfig` (Task 4); `isOriginAllowed` from `src/ws-auth.js`.
- Produces:
  - `checkBearerToken(expected: string, header: string | undefined): boolean`
  - `type RunsIngestAuthResult = 'disabled' | 'no-token-configured' | 'unauthorized' | 'ok'`
  - `checkRunsIngestAuth(cfg, header): RunsIngestAuthResult`
  - `type RunsControlAuthResult = 'disabled' | 'forbidden' | 'ok'`
  - `checkRunsControlAuth(cfg, origin, allowedOrigins): RunsControlAuthResult`

- [ ] **Step 1: Write the failing auth tests**

Create `tests/agent-runs-auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkBearerToken } from '../src/bearer-auth.js'
import { checkRunsIngestAuth, checkRunsControlAuth } from '../src/agent-runs/auth.js'
import { checkUploadAuth, parseUploadAuthConfig } from '../src/upload-auth.js'

const enabled = { enabled: true, runsDir: '/tmp/runs', token: 's3cret' }

describe('checkBearerToken', () => {
  it('accepts a correct Bearer header, case-insensitively on the scheme', () => {
    expect(checkBearerToken('s3cret', 'Bearer s3cret')).toBe(true)
    expect(checkBearerToken('s3cret', 'bearer s3cret')).toBe(true)
    expect(checkBearerToken('s3cret', '  Bearer   s3cret  ')).toBe(true)
  })

  it('rejects a wrong, missing, malformed or differently-sized token', () => {
    expect(checkBearerToken('s3cret', 'Bearer wrong!')).toBe(false)
    expect(checkBearerToken('s3cret', undefined)).toBe(false)
    expect(checkBearerToken('s3cret', 's3cret')).toBe(false)        // no scheme
    expect(checkBearerToken('s3cret', 'Basic s3cret')).toBe(false)
    expect(checkBearerToken('s3cret', 'Bearer s3cretlonger')).toBe(false)
    expect(checkBearerToken('s3cret', 'Bearer s3c')).toBe(false)
  })
})

describe('upload auth is unchanged by the extraction', () => {
  it('still returns the same four outcomes in the same order', () => {
    const ro = parseUploadAuthConfig({ VIBEDOCS_READ_ONLY: 'true', VIBEDOCS_UPLOAD_TOKEN: 'tok' })
    expect(checkUploadAuth(ro, 'Bearer tok')).toBe('read-only')
    expect(checkUploadAuth(parseUploadAuthConfig({}), 'Bearer tok')).toBe('no-token-configured')
    const tok = parseUploadAuthConfig({ VIBEDOCS_UPLOAD_TOKEN: 'tok' })
    expect(checkUploadAuth(tok, 'Bearer nope')).toBe('unauthorized')
    expect(checkUploadAuth(tok, 'Bearer tok')).toBe('ok')
  })
})

describe('checkRunsIngestAuth', () => {
  it('hides the endpoint when the feature is disabled', () => {
    expect(checkRunsIngestAuth({ ...enabled, enabled: false }, 'Bearer s3cret')).toBe('disabled')
  })

  it('hides the endpoint when no token is configured, rather than 401-ing', () => {
    // Same reasoning as uploads: an unauthenticated scanner should not be able
    // to fingerprint the feature.
    expect(checkRunsIngestAuth({ ...enabled, token: null }, undefined)).toBe('no-token-configured')
  })

  it('rejects a wrong token and accepts the right one', () => {
    expect(checkRunsIngestAuth(enabled, 'Bearer nope')).toBe('unauthorized')
    expect(checkRunsIngestAuth(enabled, undefined)).toBe('unauthorized')
    expect(checkRunsIngestAuth(enabled, 'Bearer s3cret')).toBe('ok')
  })

  it('checks disabled before token, so a disabled server never reveals token state', () => {
    expect(checkRunsIngestAuth({ enabled: false, runsDir: '/x', token: null }, undefined)).toBe('disabled')
  })
})

describe('checkRunsControlAuth', () => {
  const allow = ['http://localhost:8080', 'http://127.0.0.1:8080']

  it('accepts a same-origin browser write with no token at all', () => {
    expect(checkRunsControlAuth({ enabled: true }, 'http://localhost:8080', allow)).toBe('ok')
    expect(checkRunsControlAuth({ enabled: true }, 'http://127.0.0.1:8080', allow)).toBe('ok')
  })

  it('rejects a cross-origin write — this is the CSRF boundary', () => {
    expect(checkRunsControlAuth({ enabled: true }, 'https://attacker.example.com', allow)).toBe('forbidden')
  })

  it('rejects a request with no Origin header', () => {
    // A browser always sends Origin on POST/PATCH. Absence means a non-browser
    // client, and those belong on the token path.
    expect(checkRunsControlAuth({ enabled: true }, undefined, allow)).toBe('forbidden')
    expect(checkRunsControlAuth({ enabled: true }, '', allow)).toBe('forbidden')
  })

  it('matches origins case-insensitively', () => {
    expect(checkRunsControlAuth({ enabled: true }, 'HTTP://LOCALHOST:8080', allow)).toBe('ok')
  })

  it('reports disabled before anything else', () => {
    expect(checkRunsControlAuth({ enabled: false }, 'http://localhost:8080', allow)).toBe('disabled')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/agent-runs-auth.test.ts`
Expected: FAIL — `Cannot find module '../../src/bearer-auth.js'`.

- [ ] **Step 3: Extract the bearer primitive**

Create `src/bearer-auth.ts`:

```ts
/**
 * Shared bearer-token comparison.
 *
 * Extracted from src/upload-auth.ts so the agent-runs ingest endpoint reuses
 * exactly this comparison rather than growing a second, subtly different one.
 * Upload's public API is unchanged.
 */
import { timingSafeEqual } from 'crypto'

/**
 * Constant-time `Authorization: Bearer <token>` check.
 *
 * Different-length inputs fail fast — timingSafeEqual requires equal lengths,
 * and length is not the secret.
 */
export function checkBearerToken(expected: string, authorizationHeader: string | undefined): boolean {
  if (!authorizationHeader) return false
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  if (!match) return false
  const provided = match[1].trim()
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}
```

- [ ] **Step 4: Delegate from upload-auth**

In `src/upload-auth.ts`: delete the `import { timingSafeEqual } from 'crypto'` line at the top, add `import { checkBearerToken } from './bearer-auth.js'`, and replace the body after the `if (cfg.token === null) return 'no-token-configured'` check with:

```ts
  return checkBearerToken(cfg.token, authorizationHeader) ? 'ok' : 'unauthorized'
```

`tests/upload-auth.test.ts` and `tests/upload-pipeline.test.ts` are the regression gate and must stay green **without modification**.

- [ ] **Step 5: Write the runs auth gates**

Create `src/agent-runs/auth.ts`:

```ts
/**
 * Agent Runs authorization — two paths, two threat models.
 *
 *   INGEST   POST /api/runs, POST /api/runs/:id/events, POST .../ack
 *            A dispatch client, possibly not on this machine, holding a shared
 *            secret. Bearer token, same policy shape as uploads.
 *
 *   CONTROL  PATCH /api/runs/:id, POST /api/runs/:id/commands
 *            The browser UI: Stop, mark merged, mark failed. It has no secret
 *            and must never be given one — handing the ingest token to the page
 *            would put it in devtools and in every page load. The check is
 *            same-origin instead, reusing the WS Origin allowlist, which is the
 *            CSRF boundary for these writes.
 *
 * Reads stay open on loopback.
 */

import { checkBearerToken } from '../bearer-auth.js'
import { isOriginAllowed } from '../ws-auth.js'
import type { AgentRunsEnvConfig } from './config.js'

export type RunsIngestAuthResult =
  | 'disabled'            // feature off: pretend the endpoint doesn't exist (404)
  | 'no-token-configured' // enabled but no token: same (404), don't fingerprint it
  | 'unauthorized'        // token set, header missing or wrong (401)
  | 'ok'

/**
 * Composition order mirrors the upload gate: disabled → no-token → unauthorized.
 * Checking `enabled` first means a disabled server never reveals whether a token
 * happens to be configured.
 */
export function checkRunsIngestAuth(
  cfg: Pick<AgentRunsEnvConfig, 'enabled' | 'token'>,
  authorizationHeader: string | undefined,
): RunsIngestAuthResult {
  if (!cfg.enabled) return 'disabled'
  if (cfg.token === null) return 'no-token-configured'
  return checkBearerToken(cfg.token, authorizationHeader) ? 'ok' : 'unauthorized'
}

export type RunsControlAuthResult =
  | 'disabled'  // feature off (404)
  | 'forbidden' // cross-origin or no Origin (403)
  | 'ok'

/**
 * Same-origin check for browser-initiated control writes.
 *
 * `allowNoOrigin` is deliberately false and not configurable: browsers always
 * send Origin on POST/PATCH, so a missing one means a non-browser client, and
 * those belong on the token path. (The WS handshake has its own
 * VIBEDOCS_WS_ALLOW_NO_ORIGIN escape hatch for debugging; a state-changing write
 * is not the place for one.)
 */
export function checkRunsControlAuth(
  cfg: { enabled: boolean },
  origin: string | undefined,
  allowedOrigins: readonly string[],
): RunsControlAuthResult {
  if (!cfg.enabled) return 'disabled'
  return isOriginAllowed(origin, allowedOrigins, { allowNoOrigin: false }) ? 'ok' : 'forbidden'
}
```

- [ ] **Step 6: Run the new tests plus the upload regression suite**

Run: `npx vitest run tests/agent-runs-auth.test.ts tests/upload-auth.test.ts tests/upload-pipeline.test.ts`
Expected: PASS. The upload suites must pass **unmodified** — if either needed editing, the extraction changed behaviour and is wrong.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc -p tsconfig.cli.json --noEmit` → no output.

```bash
git add src/bearer-auth.ts src/agent-runs/auth.ts src/upload-auth.ts tests/agent-runs-auth.test.ts
./scripts/check-public-safe.sh   # gate: must exit 0
git commit -m "feat(agent-runs): split ingest and control write authorization

Ingest (POST /api/runs, POST events, ack) is a dispatch client holding a shared
secret: bearer token, same gate shape and ordering as uploads. Control (PATCH
status, POST stop command) is the browser, which has no secret and must never be
given one — serving the ingest token to the page would put it in devtools. Those
writes are gated same-origin instead, reusing the WS Origin allowlist as the
CSRF boundary.

Extracts the constant-time bearer comparison to src/bearer-auth.ts so both paths
share one implementation; upload's public API and tests are untouched.

Assisted-by: Claude Opus 5"
```

---
### Task 6: Ingest orchestration

The seam that owns per-run adapter state and turns "raw vendor lines arrived" into "records written, clients nudged". Nothing here knows HTTP; nothing here knows cursor.

Adapter state is **in-memory and bounded**. It carries a thinking buffer and the set of open tool calls across batches within a run. Losing it on restart is survivable by design — Task 3's store upgrades the resulting duplicate append back into a patch — so the eviction policy can be simple.

**Files:**
- Create: `src/agent-runs/ingest.ts`
- Create: `tests/agent-runs-ingest.test.ts`

**Interfaces:**
- Consumes: `RunStore`, `CreateRunInput`, `PatchRunInput`, `AppendResult` (Task 3); `getAdapter`, `PendingRecord`, `AdapterState` (Task 2); `WsMessage` (Task 7 extends it — this task only calls the injected `broadcast`).
- Produces:
  - `createIngest(deps: IngestDeps): Ingest`
  - `interface IngestDeps { store: RunStore; broadcast: (msg: WsMessage) => void; now?: () => number; maxAdapterStates?: number }`
  - `interface Ingest { registerRun(input: CreateRunInput): Promise<RunMeta>; appendRaw(runId: string, format: string, raw: unknown[], clientSeq?: number): Promise<AppendResult>; updateRun(runId: string, patch: PatchRunInput): Promise<RunMeta>; forgetAdapterState(runId: string): void }`

- [ ] **Step 1: Write the failing ingest tests**

Create `tests/agent-runs-ingest.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { createRunStore, type RunStore } from '../src/agent-runs/store.js'
import { createIngest, type Ingest } from '../src/agent-runs/ingest.js'
import { VibedocsError } from '../src/errors.js'
import type { WsMessage } from '../src/shared/ws-messages.js'
import * as F from './agent-runs-fixtures.js'

let dir: string
let store: RunStore
let ingest: Ingest
let sent: WsMessage[]

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vibedocs-ingest-'))
  store = createRunStore({ runsDir: dir })
  sent = []
  ingest = createIngest({ store, broadcast: (m) => sent.push(m), now: () => 1_800_000_000_000 })
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const base = { title: 'Run', format: 'cursor-stream-json' }

describe('registerRun', () => {
  it('creates the run and broadcasts a run-updated nudge', async () => {
    const meta = await ingest.registerRun({ ...base, id: 'r' })
    expect(meta.id).toBe('r')
    expect(sent).toEqual([{ type: 'run-updated', runId: 'r' }])
  })

  it('rejects an unknown format before touching the disk', async () => {
    await expect(ingest.registerRun({ ...base, id: 'r2', format: 'nope' })).rejects.toThrow(VibedocsError)
    expect(await store.getRun('r2')).toBeNull()
  })
})

describe('appendRaw', () => {
  it('normalizes raw vendor lines and writes canonical records', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    const res = await ingest.appendRaw('r', 'cursor-stream-json', [F.INIT_NO_TS, F.USER_NO_TS])
    expect(res.appended).toBe(2)
    const events = await store.readEvents('r')
    expect(events.map((e) => e.kind)).toEqual(['init', 'user'])
    expect(events[0].seq).toBe(1)
  })

  it('broadcasts a run-records nudge carrying the new record count, not the payload', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    sent.length = 0
    await ingest.appendRaw('r', 'cursor-stream-json', [F.USER_NO_TS])
    expect(sent).toEqual([{ type: 'run-records', runId: 'r', recCount: 1 }])
  })

  it('does not broadcast when a batch produced no records', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    sent.length = 0
    // Thinking deltas with no terminator buffer in adapter state and emit nothing.
    await ingest.appendRaw('r', 'cursor-stream-json', [F.THINKING_DELTAS[0]])
    expect(sent).toEqual([])
  })

  it('carries adapter state across calls so a tool pairs and thinking coalesces', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    await ingest.appendRaw('r', 'cursor-stream-json', [F.SHELL_STARTED, F.THINKING_DELTAS[0]])
    await ingest.appendRaw('r', 'cursor-stream-json', [F.THINKING_DELTAS[1], F.THINKING_DELTAS[2], F.SHELL_COMPLETED_OK])

    const events = await store.readEvents('r')
    const tool = events.find((e) => e.kind === 'tool')!
    expect(tool.tool).toMatchObject({ status: 'success', exitCode: 0 })
    const thinking = events.filter((e) => e.kind === 'thinking')
    expect(thinking).toHaveLength(1)                                   // coalesced across batches
    expect(thinking[0].text).toBe('**Reading** the router setup')
  })

  it('keeps adapter state separate per run', async () => {
    await ingest.registerRun({ ...base, id: 'a' })
    await ingest.registerRun({ ...base, id: 'b' })
    await ingest.appendRaw('a', 'cursor-stream-json', [F.SHELL_STARTED])
    await ingest.appendRaw('b', 'cursor-stream-json', [F.SHELL_COMPLETED_OK])
    // b never saw the start, so it appends a complete event rather than patching a's.
    expect(await store.readEvents('a')).toHaveLength(1)
    expect((await store.readEvents('a'))[0].tool!.status).toBe('running')
    expect((await store.readEvents('b'))[0].tool!.status).toBe('success')
  })

  it('rejects an unknown format', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    await expect(ingest.appendRaw('r', 'nope', [F.USER_NO_TS])).rejects.toThrow(VibedocsError)
  })

  it('rejects a run that does not exist', async () => {
    await expect(ingest.appendRaw('ghost', 'cursor-stream-json', [F.USER_NO_TS])).rejects.toThrow(VibedocsError)
  })

  it('passes clientSeq through so a replayed batch is deduped', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    await ingest.appendRaw('r', 'cursor-stream-json', [F.USER_NO_TS], 1)
    const replay = await ingest.appendRaw('r', 'cursor-stream-json', [F.USER_NO_TS], 1)
    expect(replay.deduped).toBe(true)
    expect(await store.readEvents('r')).toHaveLength(1)
  })

  it('server-stamps events the vendor left undated, using the injected clock', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    await ingest.appendRaw('r', 'cursor-stream-json', [F.RESULT_NO_TS])
    expect((await store.readEvents('r'))[0].ts).toBe(1_800_000_000_000)
  })

  it('evicts the least-recently-used adapter state past the bound', async () => {
    const small = createIngest({ store, broadcast: () => {}, maxAdapterStates: 2 })
    for (const id of ['a', 'b', 'c']) await small.registerRun({ ...base, id })
    await small.appendRaw('a', 'cursor-stream-json', [F.SHELL_STARTED])
    await small.appendRaw('b', 'cursor-stream-json', [F.SHELL_STARTED])
    await small.appendRaw('c', 'cursor-stream-json', [F.SHELL_STARTED])  // evicts 'a'

    // 'a' lost its openCalls, so the completion arrives as a fresh append —
    // which the store then upgrades back into a patch. Net effect: still correct.
    await small.appendRaw('a', 'cursor-stream-json', [F.SHELL_COMPLETED_OK])
    const events = await store.readEvents('a')
    expect(events).toHaveLength(1)
    expect(events[0].tool!.status).toBe('success')
  })
})

describe('updateRun', () => {
  it('patches meta and broadcasts run-updated', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    sent.length = 0
    const meta = await ingest.updateRun('r', { status: 'waiting' })
    expect(meta.status).toBe('waiting')
    expect(sent).toEqual([{ type: 'run-updated', runId: 'r' }])
  })

  it('drops adapter state when a run reaches a terminal status', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    await ingest.appendRaw('r', 'cursor-stream-json', [F.SHELL_STARTED])
    await ingest.updateRun('r', { status: 'done' })
    // State is gone, so a late completion appends and the store upgrades it.
    await ingest.appendRaw('r', 'cursor-stream-json', [F.SHELL_COMPLETED_OK])
    expect(await store.readEvents('r')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/agent-runs-ingest.test.ts`
Expected: FAIL — `Cannot find module '../../src/agent-runs/ingest.js'`.

- [ ] **Step 3: Write the ingest module**

Create `src/agent-runs/ingest.ts`:

```ts
/**
 * Ingest — the seam between "raw vendor lines arrived" and "records written,
 * clients nudged". Knows nothing about HTTP and nothing about any vendor.
 *
 * Its one piece of state is a per-run adapter state, which carries a thinking
 * buffer and the set of open tool calls across batches. That state is in-memory
 * and bounded; losing it is survivable by design, because the store rebuilds its
 * callId index from disk and upgrades the resulting duplicate append back into a
 * patch (see src/agent-runs/store.ts). That is what lets the eviction policy
 * here stay this simple.
 */

import { getAdapter } from './formats/index.js'
import type { AdapterState } from './formats/types.js'
import type { AppendResult, CreateRunInput, PatchRunInput, RunStore } from './store.js'
import type { RunMeta, RunStatus } from '../shared/agent-run-types.js'
import type { WsMessage } from '../shared/ws-messages.js'
import { runUpdatedMessage, runRecordsMessage } from '../shared/ws-messages.js'
import { VibedocsError } from '../errors.js'

/** Once a run reaches one of these, no further events are expected. */
const TERMINAL_STATUSES: readonly RunStatus[] = ['done', 'failed', 'stopped']

const DEFAULT_MAX_ADAPTER_STATES = 64

export interface IngestDeps {
  store: RunStore
  broadcast: (msg: WsMessage) => void
  /** Injected clock — the adapter stamps undated events with it. */
  now?: () => number
  maxAdapterStates?: number
}

export interface Ingest {
  registerRun(input: CreateRunInput): Promise<RunMeta>
  appendRaw(runId: string, format: string, raw: unknown[], clientSeq?: number): Promise<AppendResult>
  updateRun(runId: string, patch: PatchRunInput): Promise<RunMeta>
  forgetAdapterState(runId: string): void
}

export function createIngest(deps: IngestDeps): Ingest {
  const { store, broadcast } = deps
  const now = deps.now ?? (() => Date.now())
  const maxStates = deps.maxAdapterStates ?? DEFAULT_MAX_ADAPTER_STATES

  /** Insertion order is LRU order — re-set on access to move an entry to the end. */
  const states = new Map<string, AdapterState>()

  function requireAdapter(format: string) {
    const adapter = getAdapter(format)
    if (!adapter) throw new VibedocsError('invalid', `Unknown run format: ${format}`)
    return adapter
  }

  function stateFor(runId: string, format: string): AdapterState {
    const adapter = requireAdapter(format)
    const existing = states.get(runId)
    if (existing) {
      states.delete(runId)
      states.set(runId, existing) // refresh LRU position
      return existing
    }
    const fresh = adapter.createState()
    states.set(runId, fresh)
    while (states.size > maxStates) {
      const oldest = states.keys().next().value as string | undefined
      if (oldest === undefined) break
      states.delete(oldest)
    }
    return fresh
  }

  return {
    async registerRun(input) {
      requireAdapter(input.format) // reject before touching the disk
      const meta = await store.createRun(input)
      broadcast(runUpdatedMessage(meta.id))
      return meta
    },

    async appendRaw(runId, format, raw, clientSeq) {
      const adapter = requireAdapter(format)
      const meta = await store.getRun(runId)
      if (!meta) throw new VibedocsError('not-found', `Run not found: ${runId}`)

      const pending = adapter.normalize(raw, stateFor(runId, format), { now })
      const result = await store.appendRecords(runId, pending, clientSeq)

      // Nudge only. The message carries a count, never the payload — clients
      // fetch ?fromRec=, which is the same path reconnect catch-up uses.
      if (result.appended > 0) broadcast(runRecordsMessage(runId, result.recCount))
      return result
    },

    async updateRun(runId, patch) {
      const meta = await store.patchRun(runId, patch)
      if (patch.status !== undefined && TERMINAL_STATUSES.includes(patch.status)) {
        states.delete(runId)
      }
      broadcast(runUpdatedMessage(runId))
      return meta
    },

    forgetAdapterState(runId) {
      states.delete(runId)
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/agent-runs-ingest.test.ts`
Expected: PASS, 13 tests. (Requires the WS constructors from Task 7 Step 1 — do that step first if the import fails.)

- [ ] **Step 5: Commit**

```bash
git add src/agent-runs/ingest.ts tests/agent-runs-ingest.test.ts
./scripts/check-public-safe.sh   # gate: must exit 0
git commit -m "feat(agent-runs): ingest orchestration with bounded per-run adapter state

Turns raw vendor lines into canonical records and nudges clients. Adapter state
carries a thinking buffer and open tool calls across batches; it is in-memory and
LRU-bounded because losing it is survivable — the store upgrades the resulting
duplicate append back into a patch.

WS messages are nudges carrying a record count, never the payload, so live
updates and reconnect catch-up share the ?fromRec= path.

Assisted-by: Claude Opus 5"
```

---

### Task 7: WS message variants, routes, and a replay tool

The HTTP surface, plus the dev tool that makes it verifiable against a real transcript.

**Files:**
- Modify: `src/shared/ws-messages.ts` (add two variants — the exhaustive switch in `frontend/src/hooks/use-websocket.ts` will fail to compile until Task 9 handles them, which is the intended forcing function)
- Create: `src/agent-runs/routes.ts`
- Create: `tests/agent-runs-routes.test.ts`
- Create: `scripts/replay-transcript.mjs`
- Modify: `src/app-state.ts` (own the store + ingest, expose `agentRuns`)
- Modify: `src/server.ts` (register routes, log the mode)
- Modify: `src/upload-route.ts` (`/api/config` also reports `runsEnabled`)

**Interfaces:**
- Consumes: `Ingest` (Task 6), `RunStore` (Task 3), `checkRunsIngestAuth` / `checkRunsControlAuth` (Task 5), `AgentRunsEnvConfig` / `AgentRunsClientConfig` (Task 4).
- Produces:
  - `runUpdatedMessage(runId): RunUpdatedMessage`, `runRecordsMessage(runId, recCount): RunRecordsMessage`
  - `registerAgentRunsRoutes(app: Hono, deps: AgentRunsRouteDeps): void`
  - `interface AgentRunsRouteDeps { cfg: AgentRunsEnvConfig; clientConfig: AgentRunsClientConfig; store: RunStore; ingest: Ingest; allowedOrigins: readonly string[] }`

**Route table** (the shape Daniel signed off on):

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/runs` | bearer | Body `{id?, title, description?, status?, links?, format, agent?, workdir?}` → `{data:{id, url}}` |
| `POST` | `/api/runs/:id/events` | bearer | Body `{format, clientSeq?, events:[…raw vendor…]}` → `{data:{recCount, eventCount, appended, deduped}}` |
| `PATCH` | `/api/runs/:id` | same-origin | Partial `{title?, description?, status?, links?}` |
| `GET` | `/api/runs` | open | Rail data |
| `GET` | `/api/runs/:id` | open | Run meta |
| `GET` | `/api/runs/:id/events?fromRec=N` | open | `{data:{records, recCount}}` |
| `GET` | `/api/runs/config` | open | `{data:{linkify, editorScheme}}` |

- [ ] **Step 1: Extend the WS protocol**

In `src/shared/ws-messages.ts`, add the two variants, their constructors, and their parser cases. Both are **nudges** — a payload would make live updates and catch-up two different code paths.

```ts
export interface RunUpdatedMessage {
  type: 'run-updated'
  runId: string
}

/** New records are available; the client fetches ?fromRec=<its own count>. */
export interface RunRecordsMessage {
  type: 'run-records'
  runId: string
  recCount: number
}

export type WsMessage = ReloadMessage | RefreshTreeMessage | RunUpdatedMessage | RunRecordsMessage

export function runUpdatedMessage(runId: string): RunUpdatedMessage {
  return { type: 'run-updated', runId }
}

export function runRecordsMessage(runId: string, recCount: number): RunRecordsMessage {
  return { type: 'run-records', runId, recCount }
}
```

…and in `parseWsMessage`'s switch, before `default`:

```ts
    case 'run-updated':
      return typeof obj.runId === 'string' ? { type: 'run-updated', runId: obj.runId } : null
    case 'run-records':
      return typeof obj.runId === 'string' && typeof obj.recCount === 'number'
        ? { type: 'run-records', runId: obj.runId, recCount: obj.recCount }
        : null
```

Add cases to `tests/ws-messages.test.ts` mirroring the existing ones: round-trip each constructor through `parseWsMessage`, and assert a `run-records` payload with a non-numeric `recCount` parses to `null`.

- [ ] **Step 2: Write the failing route tests**

Create `tests/agent-runs-routes.test.ts`. These drive `app.request()` directly — no socket needed.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { createRunStore } from '../src/agent-runs/store.js'
import { createIngest } from '../src/agent-runs/ingest.js'
import { registerAgentRunsRoutes } from '../src/agent-runs/routes.js'
import { registerErrorHandler } from '../src/errors.js'
import { applyRecords } from '../src/shared/agent-run-types.js'
import * as F from './agent-runs-fixtures.js'

const ORIGIN = 'http://localhost:8080'
const ALLOWED = [ORIGIN]
const TOKEN = 's3cret'

let dir: string
let app: Hono

function build(over: { enabled?: boolean; token?: string | null } = {}) {
  const store = createRunStore({ runsDir: dir })
  const ingest = createIngest({ store, broadcast: () => {} })
  const a = new Hono()
  registerErrorHandler(a)
  registerAgentRunsRoutes(a, {
    cfg: { enabled: over.enabled ?? true, runsDir: dir, token: over.token === undefined ? TOKEN : over.token },
    clientConfig: { linkify: [{ pattern: 'X-\\d+', url: 'https://t.example.com/$1', kind: 'issue' }], editorScheme: 'editor://file' },
    store,
    ingest,
    allowedOrigins: ALLOWED,
  })
  return a
}

const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const ctrl = { Origin: ORIGIN, 'Content-Type': 'application/json' }

async function createRun(id = 'r') {
  return app.request('/api/runs', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ id, title: 'Run', format: 'cursor-stream-json', workdir: '/home/dev/app' }),
  })
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vibedocs-routes-'))
  app = build()
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('ingest auth', () => {
  it('404s every runs route when the feature is disabled', async () => {
    app = build({ enabled: false })
    expect((await createRun()).status).toBe(404)
    expect((await app.request('/api/runs')).status).toBe(404)
    expect((await app.request('/api/runs/r')).status).toBe(404)
  })

  it('404s writes when no token is configured, so the feature cannot be fingerprinted', async () => {
    app = build({ token: null })
    expect((await createRun()).status).toBe(404)
  })

  it('401s a wrong or missing bearer token', async () => {
    const bad = await app.request('/api/runs', {
      method: 'POST',
      headers: { Authorization: 'Bearer nope', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', format: 'cursor-stream-json' }),
    })
    expect(bad.status).toBe(401)
  })

  it('creates a run and returns its id and url', async () => {
    const res = await createRun()
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toBe('r')
    expect(data.url).toBe('/#/runs/r')
  })

  it('400s an unknown format and a missing title', async () => {
    const badFormat = await app.request('/api/runs', {
      method: 'POST', headers: auth, body: JSON.stringify({ title: 'x', format: 'nope' }),
    })
    expect(badFormat.status).toBe(400)
    const noTitle = await app.request('/api/runs', {
      method: 'POST', headers: auth, body: JSON.stringify({ format: 'cursor-stream-json' }),
    })
    expect(noTitle.status).toBe(400)
  })

  it('400s a traversing run id rather than creating a directory', async () => {
    const res = await app.request('/api/runs', {
      method: 'POST', headers: auth, body: JSON.stringify({ id: '../evil', title: 'x', format: 'cursor-stream-json' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST events', () => {
  beforeEach(async () => { await createRun() })

  it('accepts a raw vendor batch and reports counts', async () => {
    const res = await app.request('/api/runs/r/events', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ format: 'cursor-stream-json', clientSeq: 1, events: [F.INIT_NO_TS, F.USER_NO_TS] }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ appended: 2, eventCount: 2, deduped: false })
  })

  it('is idempotent on a replayed clientSeq', async () => {
    const body = JSON.stringify({ format: 'cursor-stream-json', clientSeq: 1, events: [F.USER_NO_TS] })
    await app.request('/api/runs/r/events', { method: 'POST', headers: auth, body })
    const replay = await app.request('/api/runs/r/events', { method: 'POST', headers: auth, body })
    expect((await replay.json()).data.deduped).toBe(true)
  })

  it('404s events for an unknown run', async () => {
    const res = await app.request('/api/runs/ghost/events', {
      method: 'POST', headers: auth, body: JSON.stringify({ format: 'cursor-stream-json', events: [] }),
    })
    expect(res.status).toBe(404)
  })

  it('400s a body whose events field is not an array', async () => {
    const res = await app.request('/api/runs/r/events', {
      method: 'POST', headers: auth, body: JSON.stringify({ format: 'cursor-stream-json', events: 'nope' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('control writes', () => {
  beforeEach(async () => { await createRun() })

  it('accepts a same-origin PATCH with no token at all', async () => {
    const res = await app.request('/api/runs/r', {
      method: 'PATCH', headers: ctrl, body: JSON.stringify({ status: 'waiting' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('waiting')
  })

  it('403s a cross-origin PATCH', async () => {
    const res = await app.request('/api/runs/r', {
      method: 'PATCH',
      headers: { Origin: 'https://attacker.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(res.status).toBe(403)
  })

  it('403s a PATCH with no Origin header', async () => {
    const res = await app.request('/api/runs/r', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }),
    })
    expect(res.status).toBe(403)
  })

  it('400s an unknown status value', async () => {
    const res = await app.request('/api/runs/r', {
      method: 'PATCH', headers: ctrl, body: JSON.stringify({ status: 'banana' }),
    })
    expect(res.status).toBe(400)
  })

  it('400s a links array whose entries are malformed or use an unsafe scheme', async () => {
    const bad = await app.request('/api/runs/r', {
      method: 'PATCH', headers: ctrl, body: JSON.stringify({ links: [{ label: 'x', url: 'javascript:alert(1)', kind: 'pr' }] }),
    })
    expect(bad.status).toBe(400)
  })
})

describe('reads', () => {
  beforeEach(async () => {
    await createRun()
    await app.request('/api/runs/r/events', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ format: 'cursor-stream-json', events: [F.SHELL_STARTED, F.SHELL_COMPLETED_OK] }),
    })
  })

  it('lists runs without requiring any auth', async () => {
    const res = await app.request('/api/runs')
    expect(res.status).toBe(200)
    expect((await res.json()).data.map((r: any) => r.id)).toEqual(['r'])
  })

  it('returns run meta, and 404s an unknown run', async () => {
    expect((await app.request('/api/runs/r')).status).toBe(200)
    expect((await app.request('/api/runs/ghost')).status).toBe(404)
  })

  it('pages records by fromRec and folds to one completed tool event', async () => {
    const res = await app.request('/api/runs/r/events?fromRec=0')
    const { data } = await res.json()
    expect(data.recCount).toBe(2)
    const events = applyRecords([], data.records)
    expect(events).toHaveLength(1)
    expect(events[0].tool).toMatchObject({ status: 'success', exitCode: 0 })
  })

  it('returns only the tail past fromRec', async () => {
    const { data } = await (await app.request('/api/runs/r/events?fromRec=1')).json()
    expect(data.records).toHaveLength(1)
    expect(data.recCount).toBe(2)
  })

  it('treats a missing or nonsense fromRec as 0', async () => {
    for (const q of ['', '?fromRec=', '?fromRec=abc', '?fromRec=-5']) {
      const { data } = await (await app.request(`/api/runs/r/events${q}`)).json()
      expect(data.records).toHaveLength(2)
    }
  })

  it('serves the client config for linkification', async () => {
    const { data } = await (await app.request('/api/runs/config')).json()
    expect(data.editorScheme).toBe('editor://file')
    expect(data.linkify).toHaveLength(1)
  })

  it('never leaks the ingest token in any read response', async () => {
    for (const p of ['/api/runs', '/api/runs/r', '/api/runs/config', '/api/runs/r/events']) {
      expect(await (await app.request(p)).text()).not.toContain(TOKEN)
    }
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/agent-runs-routes.test.ts`
Expected: FAIL — `Cannot find module '../../src/agent-runs/routes.js'`.

- [ ] **Step 4: Write the routes**

Create `src/agent-runs/routes.ts`:

```ts
/**
 * Agent Runs HTTP surface.
 *
 * Auth is split by path, not by method — see src/agent-runs/auth.ts:
 *   POST /api/runs, POST /api/runs/:id/events   bearer token (dispatch client)
 *   PATCH /api/runs/:id                          same-origin (browser UI)
 *   GET  everything                              open on loopback
 *
 * Every 'disabled' outcome renders as 404 rather than 403, so a server with the
 * feature off is indistinguishable from one that never had it.
 */

import type { Context, Hono } from 'hono'
import { checkRunsControlAuth, checkRunsIngestAuth } from './auth.js'
import type { AgentRunsEnvConfig } from './config.js'
import type { Ingest } from './ingest.js'
import type { RunStore } from './store.js'
import { RUN_STATUSES, type RunLink, type RunStatus } from '../shared/agent-run-types.js'
import { isSafeUrlTemplate, type AgentRunsClientConfig } from '../shared/agent-runs-config-types.js'
import { VibedocsError } from '../errors.js'

export interface AgentRunsRouteDeps {
  cfg: AgentRunsEnvConfig
  clientConfig: AgentRunsClientConfig
  store: RunStore
  ingest: Ingest
  allowedOrigins: readonly string[]
}

const VALID_LINK_KINDS = new Set(['issue', 'pr', 'ci', 'other'])

function parseLinks(value: unknown): RunLink[] {
  if (!Array.isArray(value)) throw new VibedocsError('invalid', 'links must be an array')
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new VibedocsError('invalid', 'link must be an object')
    const l = raw as Record<string, unknown>
    if (typeof l.label !== 'string' || typeof l.url !== 'string') {
      throw new VibedocsError('invalid', 'link requires string label and url')
    }
    // A link goes straight into an href; an executable scheme must not survive
    // even though the frontend sanitizes too. Defense in depth, cheap here.
    if (!isSafeUrlTemplate(l.url)) throw new VibedocsError('invalid', 'link url scheme not allowed')
    const kind = typeof l.kind === 'string' && VALID_LINK_KINDS.has(l.kind) ? (l.kind as RunLink['kind']) : 'other'
    return { label: l.label, url: l.url, kind }
  })
}

function parseStatus(value: unknown): RunStatus {
  if (typeof value !== 'string' || !RUN_STATUSES.includes(value as RunStatus)) {
    throw new VibedocsError('invalid', `status must be one of: ${RUN_STATUSES.join(', ')}`)
  }
  return value as RunStatus
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new VibedocsError('invalid', 'Body must be a JSON object')
    }
    return body as Record<string, unknown>
  } catch (err) {
    if (err instanceof VibedocsError) throw err
    throw new VibedocsError('invalid', 'Body must be valid JSON')
  }
}

export function registerAgentRunsRoutes(app: Hono, deps: AgentRunsRouteDeps): void {
  const { cfg, clientConfig, store, ingest, allowedOrigins } = deps

  /** Returns a Response to short-circuit with, or null to proceed. */
  function ingestGate(c: Context): Response | null {
    switch (checkRunsIngestAuth(cfg, c.req.header('Authorization'))) {
      case 'disabled':
      case 'no-token-configured':
        return c.json({ error: 'Not Found' }, 404)
      case 'unauthorized':
        return c.json({ error: 'Unauthorized' }, 401)
      case 'ok':
        return null
    }
  }

  function controlGate(c: Context): Response | null {
    switch (checkRunsControlAuth(cfg, c.req.header('Origin'), allowedOrigins)) {
      case 'disabled':
        return c.json({ error: 'Not Found' }, 404)
      case 'forbidden':
        return c.json({ error: 'Forbidden' }, 403)
      case 'ok':
        return null
    }
  }

  function readGate(c: Context): Response | null {
    return cfg.enabled ? null : c.json({ error: 'Not Found' }, 404)
  }

  // ── Ingest ────────────────────────────────────────────────────────────────

  app.post('/api/runs', async (c) => {
    const denied = ingestGate(c)
    if (denied) return denied

    const body = await readJson(c)
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      throw new VibedocsError('invalid', 'title is required')
    }
    if (typeof body.format !== 'string') throw new VibedocsError('invalid', 'format is required')

    const meta = await ingest.registerRun({
      id: typeof body.id === 'string' ? body.id : undefined,
      title: body.title,
      description: typeof body.description === 'string' ? body.description : undefined,
      status: body.status !== undefined ? parseStatus(body.status) : undefined,
      links: body.links !== undefined ? parseLinks(body.links) : undefined,
      format: body.format,
      agent: typeof body.agent === 'string' ? body.agent : undefined,
      workdir: typeof body.workdir === 'string' ? body.workdir : undefined,
    })
    return c.json({ data: { id: meta.id, url: `/#/runs/${encodeURIComponent(meta.id)}` } })
  })

  app.post('/api/runs/:id/events', async (c) => {
    const denied = ingestGate(c)
    if (denied) return denied

    const body = await readJson(c)
    if (typeof body.format !== 'string') throw new VibedocsError('invalid', 'format is required')
    if (!Array.isArray(body.events)) throw new VibedocsError('invalid', 'events must be an array')
    const clientSeq = typeof body.clientSeq === 'number' ? body.clientSeq : undefined

    const result = await ingest.appendRaw(c.req.param('id'), body.format, body.events, clientSeq)
    return c.json({ data: result })
  })

  // ── Control ───────────────────────────────────────────────────────────────

  app.patch('/api/runs/:id', async (c) => {
    const denied = controlGate(c)
    if (denied) return denied

    const body = await readJson(c)
    const meta = await ingest.updateRun(c.req.param('id'), {
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: parseStatus(body.status) } : {}),
      ...(body.links !== undefined ? { links: parseLinks(body.links) } : {}),
    })
    return c.json({ data: meta })
  })

  // ── Reads ─────────────────────────────────────────────────────────────────

  app.get('/api/runs', async (c) => {
    const denied = readGate(c)
    if (denied) return denied
    return c.json({ data: await store.listRuns() })
  })

  app.get('/api/runs/config', (c) => {
    const denied = readGate(c)
    if (denied) return denied
    return c.json({ data: clientConfig })
  })

  app.get('/api/runs/:id', async (c) => {
    const denied = readGate(c)
    if (denied) return denied
    const meta = await store.getRun(c.req.param('id'))
    if (!meta) throw new VibedocsError('not-found', 'Run not found')
    return c.json({ data: meta })
  })

  app.get('/api/runs/:id/events', async (c) => {
    const denied = readGate(c)
    if (denied) return denied
    const meta = await store.getRun(c.req.param('id'))
    if (!meta) throw new VibedocsError('not-found', 'Run not found')

    const raw = parseInt(c.req.query('fromRec') ?? '0', 10)
    const fromRec = Number.isFinite(raw) && raw > 0 ? raw : 0
    return c.json({ data: await store.readRecords(c.req.param('id'), fromRec) })
  })
}
```

**Route ordering note:** `/api/runs/config` is declared before `/api/runs/:id`. Hono matches in registration order, so the reverse would make `config` resolve as a run id and 404. The "serves the client config" test is the guard.

- [ ] **Step 5: Wire into app-state, server, and /api/config**

In `src/app-state.ts`: build the store and ingest inside `runLive` alongside the existing wiring, and expose them on `LiveAppState`.

```ts
// near the other imports
import { parseAgentRunsEnv, loadAgentRunsClientConfig } from './agent-runs/config.js'
import { createRunStore } from './agent-runs/store.js'
import { createIngest } from './agent-runs/ingest.js'
import { homedir } from 'os'

// inside runLive, after `const inner = createAppState({...})`:
const agentRunsCfg = parseAgentRunsEnv(env as Record<string, string | undefined>, homedir())
const agentRunsClientConfig = await loadAgentRunsClientConfig(agentRunsCfg.runsDir)
const runStore = createRunStore({ runsDir: agentRunsCfg.runsDir })
const runIngest = createIngest({ store: runStore, broadcast: (msg) => clientChannel.broadcast(msg) })

// add to the returned object:
  agentRuns: { cfg: agentRunsCfg, clientConfig: agentRunsClientConfig, store: runStore, ingest: runIngest },
```

…and add the matching field to the `LiveAppState` interface:

```ts
  readonly agentRuns: {
    cfg: AgentRunsEnvConfig
    clientConfig: AgentRunsClientConfig
    store: RunStore
    ingest: Ingest
  }
```

In `src/server.ts`, after `registerFileRoute(...)` and **before** `registerStaticRoutes(...)`.

This ordering is load-bearing, and the failure mode is worse than "route not found". Verified against the running dev server 2026-08-12: the SPA fallback answers **any** unmatched path with `200` and `text/html`, including `/api/nope`. So registering the runs routes after it would not 404 — it would return an HTML page with a success status, and any client checking `res.ok` (including `scripts/replay-transcript.mjs`) would report the push as having worked. Add a route test asserting `GET /api/runs` returns `content-type: application/json`, not just a 2xx.

```ts
registerAgentRunsRoutes(app, {
  cfg: state.agentRuns.cfg,
  clientConfig: state.agentRuns.clientConfig,
  store: state.agentRuns.store,
  ingest: state.agentRuns.ingest,
  allowedOrigins,
})
```

`allowedOrigins` is currently computed *after* the server boots (line 68). Move that computation above the route registrations — it only reads env and `PORT`, so it has no ordering dependency on the HTTP server. Add the mode log beside the existing upload one:

```ts
const runsMode = !state.agentRuns.cfg.enabled ? 'DISABLED'
  : state.agentRuns.cfg.token === null ? 'READ-ONLY (no ingest token)'
  : 'ENABLED'
console.log(`  🔒 Agent runs: ${runsMode}`)
```

In `src/upload-route.ts`, extend `registerConfigRoute` to take the runs-enabled flag and report it, so the frontend knows whether to show the Runs nav:

```ts
export function registerConfigRoute(app: Hono, cfg: UploadAuthConfig, runsEnabled = false): void {
  app.get('/api/config', (c) => {
    const uploadEnabled = !cfg.readOnly && cfg.token !== null
    return c.json({ uploadEnabled, runsEnabled })
  })
}
```

Update the call in `src/server.ts` to `registerConfigRoute(app, state.uploadAuth, state.agentRuns.cfg.enabled)`, and extend `tests/upload-route.test.ts` (or wherever `/api/config` is asserted) with a case for each value of `runsEnabled`.

- [ ] **Step 6: Write the replay tool**

Create `scripts/replay-transcript.mjs`. Deliberately generic — it takes any ndjson path, so nothing about any particular agent or directory layout is baked in.

```js
#!/usr/bin/env node
/**
 * Replay a captured agent transcript into a running vibedocs server.
 *
 * Usage:
 *   VIBEDOCS_RUNS_TOKEN=… node scripts/replay-transcript.mjs <events.ndjson> [options]
 *
 * Options:
 *   --id <runId>        run id to create (default: the file's parent dir name)
 *   --title <text>      run title (default: the run id)
 *   --format <name>     adapter name (default: cursor-stream-json)
 *   --url <base>        server base url (default: http://localhost:8080)
 *   --batch <n>         lines per POST (default: 64)
 *   --delay <ms>        pause between batches, to watch it stream (default: 0)
 *   --workdir <path>    run workdir, used to shorten displayed paths
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('usage: replay-transcript.mjs <events.ndjson> [--id x] [--url http://localhost:8080]')
  process.exit(2)
}
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const token = process.env.VIBEDOCS_RUNS_TOKEN
if (!token) {
  console.error('VIBEDOCS_RUNS_TOKEN must be set — it is the ingest bearer token.')
  process.exit(2)
}

const base = opt('url', 'http://localhost:8080').replace(/\/$/, '')
const id = opt('id', path.basename(path.dirname(path.resolve(file))))
const title = opt('title', id)
const format = opt('format', 'cursor-stream-json')
const batchSize = parseInt(opt('batch', '64'), 10)
const delay = parseInt(opt('delay', '0'), 10)
const workdir = opt('workdir', undefined)

const lines = readFileSync(file, 'utf8')
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l) => { try { return JSON.parse(l) } catch { return null } })
  .filter(Boolean)

async function post(pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error(`${pathname} -> ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  return res.json()
}

const created = await post('/api/runs', { id, title, format, status: 'running', ...(workdir ? { workdir } : {}) })
console.log(`run ${created.data.id} -> ${base}${created.data.url}`)

let clientSeq = 0
for (let i = 0; i < lines.length; i += batchSize) {
  const batch = lines.slice(i, i + batchSize)
  const { data } = await post(`/api/runs/${encodeURIComponent(id)}/events`, { format, clientSeq: ++clientSeq, events: batch })
  process.stdout.write(`\r${Math.min(i + batchSize, lines.length)}/${lines.length} lines — ${data.eventCount} events`)
  if (delay > 0) await new Promise((r) => setTimeout(r, delay))
}
console.log(`\ndone — ${base}${created.data.url}`)
```

- [ ] **Step 7: Run every backend test and typecheck**

Run: `npx vitest run tests/` — the whole backend suite, not just the new files. The WS union change touches `parseWsMessage`, so pre-existing WS tests are part of the gate.
Run: `npx tsc -p tsconfig.cli.json --noEmit`

Expected: the CLI typecheck passes. The **frontend** typecheck will now fail on `handleWsMessage`'s `never` check in `frontend/src/hooks/use-websocket.ts`, because two variants are unhandled. That is the union doing its job — Task 9 handles them. Do not silence it here.

- [ ] **Step 8: Verify against a real transcript, end to end**

```bash
export VIBEDOCS_RUNS_ENABLED=true
export VIBEDOCS_RUNS_TOKEN=$(openssl rand -hex 16)
npm run dev:server &
node scripts/replay-transcript.mjs <path-to-a-local-transcript>/events.ndjson --id demo --workdir /path/to/checkout
curl -s localhost:8080/api/runs | head -c 400
curl -s 'localhost:8080/api/runs/demo/events?fromRec=0' | wc -c
du -sh "${VIBEDOCS_RUNS_DIR:-$HOME/.vibedocs/runs}/demo"
```

Four things to confirm:

1. `POST /api/runs` returns a `/#/runs/demo` url.
2. Every batch returns 200 and `eventCount` climbs.
3. The stored run directory is a **small fraction** of the source file — the projection from Task 2 is what makes canonical-only storage viable, and this is where it shows up end to end.
4. `curl` with **no** `Authorization` header still reads (`GET /api/runs` → 200), and a `PATCH` with no `Origin` is refused (403).

- [ ] **Step 9: Commit**

```bash
git add src/agent-runs/routes.ts src/shared/ws-messages.ts src/app-state.ts src/server.ts \
        src/upload-route.ts scripts/replay-transcript.mjs tests/agent-runs-routes.test.ts tests/ws-messages.test.ts
./scripts/check-public-safe.sh   # gate: must exit 0
git commit -m "feat(agent-runs): HTTP routes, WS nudges, and a transcript replay tool

Ingest routes take a bearer token, control routes take a same-origin Origin,
reads are open. Every disabled outcome renders 404 so a server with the feature
off is indistinguishable from one that never had it.

WS gains run-updated and run-records as nudges; the exhaustive switch in the
frontend hook now fails to compile until it handles them, which is intended.

scripts/replay-transcript.mjs pushes any captured ndjson at a running server, so
the API is verifiable against a real multi-megabyte transcript rather than a
hand-written fixture.

Assisted-by: Claude Opus 5"
```

---
### Task 8: Server-side markdown for agent text

The spec requires assistant and result bodies to render as markdown using the existing pipeline, with no client-side markdown library. `createMarkdownProcessor` cannot be reused directly for the two reasons in the refinements section: it demands project-doc options that do not exist here, and its heading slugs would collide across events on one page.

Rendered HTML is **never persisted**. `AgentEvent.textHtml` is a read-time field the route attaches; `events.ndjson` keeps only the raw markdown, so a pipeline improvement applies to every past run for free.

**Files:**
- Modify: `src/markdown-plugins.ts` (add `agentTextSanitizeSchema`)
- Modify: `src/markdown-processor.ts` (add `createAgentTextProcessor`)
- Modify: `src/shared/agent-run-types.ts` (add the read-time `textHtml` field)
- Create: `src/agent-runs/text-render.ts`
- Create: `tests/agent-runs-text-render.test.ts`
- Modify: `src/agent-runs/routes.ts` (enrich records on read)

**Interfaces:**
- Consumes: `sanitizeSchema`, `rehypeWrapTables` from `src/markdown-plugins.js`.
- Produces:
  - `agentTextSanitizeSchema: Schema`
  - `createAgentTextProcessor(): Processor`
  - `createTextRenderer(opts?: { maxEntries?: number }): TextRenderer` with `render(md: string): Promise<string>` and `readonly size: number`
  - `enrichRecords(records: EventRecord[], renderer: TextRenderer): Promise<EventRecord[]>`

- [ ] **Step 1: Write the failing render tests**

Create `tests/agent-runs-text-render.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createTextRenderer, enrichRecords } from '../src/agent-runs/text-render.js'
import type { EventRecord } from '../src/shared/agent-run-types.js'

const renderer = createTextRenderer()

describe('agent text rendering', () => {
  it('renders headings, lists, bold and inline code as markdown', async () => {
    const html = await renderer.render('## Plan\n\n- read `router.ts`\n- **add** the route')
    expect(html).toContain('<h2')
    expect(html).toContain('<li>')
    expect(html).toContain('<strong>')
    expect(html).toContain('<code>')
    expect(html).not.toContain('## Plan')   // not left as raw text
  })

  it('highlights fenced code through shiki', async () => {
    const html = await renderer.render('```ts\nconst x: number = 1\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('shiki')
  })

  it('renders GFM tables', async () => {
    const html = await renderer.render('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table')
  })

  // Agent text is untrusted — this is the security boundary.
  it('strips script tags and event-handler attributes', async () => {
    const html = await renderer.render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  it('strips javascript: hrefs', async () => {
    const html = await renderer.render('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
  })

  it('does not emit heading anchors, so two events cannot collide on one id', async () => {
    const a = await renderer.render('## Summary')
    const b = await renderer.render('## Summary')
    expect(a).toBe(b)
    expect(a).not.toContain('heading-anchor')
    // Either no id at all, or a clobber-prefixed one — never a bare `id="summary"`.
    expect(a).not.toMatch(/id="summary"/)
  })

  it('does not rewrite relative links into project asset URLs', async () => {
    const html = await renderer.render('[x](./notes.md) and ![y](./img.png)')
    expect(html).not.toContain('/api/file/')
  })

  it('returns empty string for empty input without touching the pipeline', async () => {
    expect(await renderer.render('')).toBe('')
    expect(await renderer.render('   ')).toBe('')
  })

  it('caches by content so repeated text renders once', async () => {
    const fresh = createTextRenderer()
    await fresh.render('# same')
    await fresh.render('# same')
    await fresh.render('# other')
    expect(fresh.size).toBe(2)
  })

  it('bounds the cache', async () => {
    const small = createTextRenderer({ maxEntries: 2 })
    for (const t of ['# a', '# b', '# c']) await small.render(t)
    expect(small.size).toBeLessThanOrEqual(2)
  })
})

describe('enrichRecords', () => {
  const rec = (kind: string, text?: string): EventRecord => ({
    op: 'append',
    event: { seq: 1, ts: 1, kind: kind as any, ...(text !== undefined ? { text } : {}) },
  })

  it('attaches textHtml to markdown-bearing kinds only', async () => {
    const out = await enrichRecords(
      [rec('assistant', '## a'), rec('result', '**b**'), rec('user', 'plain'), rec('thinking', '## not markdown here'), rec('other')],
      renderer,
    )
    const events = out.map((r) => (r.op === 'append' ? r.event : null))
    expect(events[0]!.textHtml).toContain('<h2')
    expect(events[1]!.textHtml).toContain('<strong>')
    expect(events[2]!.textHtml).toContain('plain')      // user briefs are markdown too
    expect(events[3]!.textHtml).toBeUndefined()          // thinking renders as plain text
    expect(events[4]!.textHtml).toBeUndefined()
  })

  it('leaves patch records untouched', async () => {
    const patch: EventRecord = { op: 'patch', seq: 1, patch: { tool: { status: 'success' } as any } }
    expect(await enrichRecords([patch], renderer)).toEqual([patch])
  })

  it('never persists textHtml back onto the source record', async () => {
    const source = rec('assistant', '## a')
    await enrichRecords([source], renderer)
    expect((source as any).event.textHtml).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/agent-runs-text-render.test.ts` → FAIL, module not found.

- [ ] **Step 3: Add the sanitize schema variant**

In `src/markdown-plugins.ts`, after the existing `sanitizeSchema` export:

```ts
/**
 * Sanitize schema for agent-run transcript text.
 *
 * Identical to `sanitizeSchema` except that rehype-sanitize's id-clobbering is
 * left ON. The page schema disables it so heading autolinks resolve, which is
 * safe because one page is rendered per document. A transcript renders many
 * untrusted blocks into ONE document, where a `id="summary"` minted by agent
 * text could clobber a real element — so the prefix stays.
 *
 * Omitting the keys (rather than setting them to undefined) is what restores
 * rehype-sanitize's own defaults.
 */
const { clobberPrefix: _clobberPrefix, clobber: _clobber, ...schemaWithoutClobberOverrides } = sanitizeSchema
export const agentTextSanitizeSchema: Schema = schemaWithoutClobberOverrides
```

- [ ] **Step 4: Add the processor factory**

In `src/markdown-processor.ts`, append:

```ts
import { agentTextSanitizeSchema } from './markdown-plugins.js'

/**
 * Processor for agent-run transcript text (assistant messages, results, user
 * briefs).
 *
 * Shares the remark/rehype/shiki/sanitize spine with `createMarkdownProcessor`
 * but deliberately omits three plugins:
 *
 *  - `rehypeRewriteUrls` — its options (projectName, currentDocPath) are
 *    project-doc concepts a transcript event does not have. Passing empties
 *    would emit `/api/file//…` URLs.
 *  - `rehypeSlug` + `rehypeAutolinkHeadings` — a timeline renders many events
 *    into one document, so two events both containing `## Summary` would mint
 *    duplicate DOM ids.
 *  - `remarkMermaid` — mermaid needs a client-side render pass the transcript
 *    view does not wire up; a `<div class="mermaid">` would render as nothing.
 *
 * Sanitization keeps id-clobbering on. Agent text is untrusted.
 */
export function createAgentTextProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeShiki, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      fallbackLanguage: 'text',
    })
    .use(rehypeWrapTables)
    .use(rehypeSanitize, agentTextSanitizeSchema)
    .use(rehypeStringify)
}
```

- [ ] **Step 5: Add the read-time field to the shared type**

In `src/shared/agent-run-types.ts`, inside `AgentEvent`:

```ts
  /**
   * Rendered HTML for `text`, attached at READ time and never persisted.
   * events.ndjson stores only the raw markdown, so improving the pipeline
   * improves every past run without a migration.
   */
  textHtml?: string
```

- [ ] **Step 6: Write the renderer**

Create `src/agent-runs/text-render.ts`:

```ts
/**
 * Markdown rendering for transcript text.
 *
 * Runs on the server using the project's existing unified pipeline — the spec
 * rules out react-markdown and a client-side highlighter as duplication.
 * Results are cached by content, because a timeline re-reads the same events on
 * every reconnect and the same assistant message often recurs across runs.
 */

import { createHash } from 'crypto'
import { createAgentTextProcessor } from '../markdown-processor.js'
import type { EventRecord, EventKind } from '../shared/agent-run-types.js'

/** Kinds whose `text` is markdown. Thinking stays plain — it is raw reasoning. */
const MARKDOWN_KINDS: readonly EventKind[] = ['assistant', 'result', 'user']

const DEFAULT_MAX_ENTRIES = 512

export interface TextRenderer {
  render(markdown: string): Promise<string>
  readonly size: number
}

export function createTextRenderer(opts: { maxEntries?: number } = {}): TextRenderer {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
  const cache = new Map<string, string>()
  const processor = createAgentTextProcessor()

  return {
    async render(markdown) {
      if (!markdown || markdown.trim().length === 0) return ''
      const key = createHash('sha256').update(markdown).digest('hex')
      const hit = cache.get(key)
      if (hit !== undefined) {
        cache.delete(key)
        cache.set(key, hit) // refresh LRU position
        return hit
      }
      const html = String(await processor.process(markdown))
      cache.set(key, html)
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value as string | undefined
        if (oldest === undefined) break
        cache.delete(oldest)
      }
      return html
    },
    get size() {
      return cache.size
    },
  }
}

/**
 * Attach `textHtml` to markdown-bearing append records. Returns new objects —
 * the caller's records (and therefore anything on its way to disk) are untouched.
 */
export async function enrichRecords(
  records: readonly EventRecord[],
  renderer: TextRenderer,
): Promise<EventRecord[]> {
  return Promise.all(
    records.map(async (rec) => {
      if (rec.op !== 'append') return rec
      const { kind, text } = rec.event
      if (!MARKDOWN_KINDS.includes(kind) || !text) return rec
      return { op: 'append' as const, event: { ...rec.event, textHtml: await renderer.render(text) } }
    }),
  )
}
```

- [ ] **Step 7: Enrich on read**

In `src/agent-runs/routes.ts`: add `renderer: TextRenderer` to `AgentRunsRouteDeps`, and in the `GET /api/runs/:id/events` handler wrap the store result:

```ts
    const page = await store.readRecords(c.req.param('id'), fromRec)
    return c.json({ data: { records: await enrichRecords(page.records, renderer), recCount: page.recCount } })
```

Construct it once in `src/app-state.ts` (`const runTextRenderer = createTextRenderer()`), expose it on `agentRuns`, and pass it through in `src/server.ts`. Add a route test asserting an assistant event comes back with `textHtml` containing `<h2`.

- [ ] **Step 8: Run tests, typecheck, commit**

Run: `npx vitest run tests/agent-runs-* tests/markdown-processor.test.ts` — the existing markdown-processor tests are the regression gate for the split and must pass unmodified.
Run: `npx tsc -p tsconfig.cli.json --noEmit`

```bash
git add src/markdown-plugins.ts src/markdown-processor.ts src/agent-runs/text-render.ts \
        src/shared/agent-run-types.ts src/agent-runs/routes.ts src/app-state.ts src/server.ts \
        tests/agent-runs-text-render.test.ts tests/agent-runs-routes.test.ts
./scripts/check-public-safe.sh   # gate: must exit 0
git commit -m "feat(agent-runs): server-side markdown rendering for transcript text

Reuses the project's unified pipeline rather than adding react-markdown. The
agent-text processor shares the remark/rehype/shiki/sanitize spine but drops URL
rewriting (its options are project-doc concepts a transcript event lacks) and
heading slugs (a timeline renders many events into one document, so two '##
Summary' events would mint duplicate ids). Sanitization keeps id-clobbering on
because agent text is untrusted.

textHtml is attached at read time and never persisted, so improving the pipeline
improves every past run without a migration.

Assisted-by: Claude Opus 5"
```

---

### Task 9: The entrypoint, then the transcript view

Two commits. **Commit A is the entrypoint and an empty Runs view** — the smallest thing that makes the feature visible and navigable. **Commit B is the rail and timeline.** Splitting them means the feature shows up in the UI as soon as the routes exist, rather than appearing all at once at the end, and each half is separately reviewable.

No follow mode, no filters, no virtualization — those are Phase B.

**Route namespace:** `#/runs` and `#/runs/:id`. The leading slash matters — `parseHash` in `frontend/src/App.tsx:24` splits on the first `/` and treats segment 0 as a project name, so a leading `/` yields an empty project, which no directory can be. That makes the namespace collision-proof against a project literally named `runs`.

#### The entrypoint (decided 2026-08-12)

A **segmented view switch at the top of the sidebar header**, directly under the logo and above the file filter.

```
┌─ sidebar ────────────────┐
│ [logo] VibeDocs      [◐] │
│ ┌───────┬────────────┐   │
│ │  Docs │ Runs   ●2  │   │  <- App View switch (new)
│ └───────┴────────────┘   │
│ [Filter files...       ] │
│ [Docs|All]      [Upload] │  <- file-type filter (existing, unrelated)
│ ▸ docs/                  │
└──────────────────────────┘
```

Four things this has to get right, none of which the earlier draft specified:

- **Naming collision — do not reuse `ViewMode`.** `frontend/src/App.tsx:51` already defines `type ViewMode = "docs" | "all"`, which is the **file-type filter** (which files appear in the tree). The new switch is a different axis entirely: which *view* the app is in. Call it **`AppView = 'docs' | 'runs'`**. Two controls in the same sidebar header would otherwise share a name and a `"docs"` value while meaning unrelated things. Add both terms to `CONTEXT.md` under a new "Agent Runs" section with an explicit `_Avoid_` note, per that file's convention.
- **Always visible when enabled, never when disabled.** Render the switch iff `runsEnabled` from `/api/config`. At zero runs it still shows, with no badge — discoverability before the first run matters more than tidiness, and it is the only way to tell "enabled but empty" from "broken". The badge counts runs whose status is **not** terminal (`done`/`failed`/`stopped`).
- **Getting back must return where you were.** Clicking `Docs` restores the last docs hash rather than dumping the user at the root. Keep the last non-runs hash in a ref updated on hashchange; fall back to `""` if there isn't one.
- **Mobile is the same component.** `AppSidebar` renders inside the `Sheet` drawer on mobile (`App.tsx:239`), so the switch appears there for free. But in Runs view the drawer must show the **run rail**, not the docs tree — so the mobile branch chooses its drawer content on `AppView`, and selecting a run closes the drawer exactly as `navigateAndCloseDrawer` does today.

**Empty state** (what you see today, with the feature on and nothing pushed): a centred panel using the existing `Empty` primitive from `frontend/src/components/ui/empty.tsx` — "No agent runs yet", one line on how a client records one (`POST /api/runs`), and a link to `docs/agent-runs.md`. **Never render the ingest token.**

**Files (Commit A):**
- Create: `frontend/src/agent-runs/RunsView.tsx` (shell + empty state), `hooks/use-runs.ts`
- Modify: `frontend/src/components/app-sidebar.tsx` (the switch), `frontend/src/App.tsx` (`AppView` routing, last-docs-hash memory, mobile drawer content), `frontend/src/hooks/use-config.ts` + `frontend/src/lib/api-client.ts` (`runsEnabled`), `frontend/src/hooks/use-websocket.ts` (the two new variants)
- Create: `frontend/tests/agent-runs-entrypoint.test.tsx`
- Modify: `CONTEXT.md` (Agent Runs vocabulary)

Tests for Commit A — the seams are `useRuns` and the switch's visibility logic, not the markup:
- the switch does not render when `runsEnabled` is false
- it renders with no badge when enabled and zero runs
- the badge counts only non-terminal runs (2 running + 1 done → `2`)
- clicking `Runs` sets the hash to `#/runs`
- clicking `Docs` restores the previous docs hash, not the root
- `RunsView` with zero runs renders the empty state and does not render a token

**Files (Commit B):**
- Create: `frontend/src/agent-runs/RunRail.tsx`, `RunHeader.tsx`, `Timeline.tsx`, `TimelineRow.tsx`
- Create: `frontend/src/agent-runs/hooks/use-run-records.ts`
- Create: `frontend/src/agent-runs/lib/tool-display.ts`
- Create: `frontend/src/agent-runs/components/{CopyButton,CodeBlock,StatusIcon,ToolIcon,KindIcon}.tsx`
- Modify: `frontend/src/agent-runs/RunsView.tsx` (swap the empty state for rail + detail once runs exist)
- Create: `frontend/tests/agent-runs-timeline-row.test.tsx`

**Interfaces:**
- Consumes: `AgentEvent`, `EventRecord`, `RunMeta`, `RunStatus`, `applyRecords` via `@shared/agent-run-types`.
- Produces:
  - `useRuns(): { runs: RunMeta[]; loading: boolean; refresh: () => void }`
  - `useRunRecords(runId: string | null): { events: AgentEvent[]; meta: RunMeta | null; loading: boolean; error: string | null }`
  - `fmtTime(ms?: number): string`, `fmtDuration(ms?: number): string`, `shortenPath(p: string, workdir?: string): string`, `toolSummary(tool: ToolInfo): string`, `toolCopyText(event: AgentEvent): string`
  - `<RunsView />`, `<RunRail runs activeId onSelect />`, `<Timeline events workdir />`, `<TimelineRow event workdir />`

- [ ] **Step A1: Handle the new WS variants (fixes the intended compile error)**

In `frontend/src/hooks/use-websocket.ts`, extend `UseWebSocketOptions` and the switch:

```ts
interface UseWebSocketOptions {
  onReload?: (path: string) => void
  onRefreshTree?: () => void
  onRunUpdated?: (runId: string) => void
  onRunRecords?: (runId: string, recCount: number) => void
}

// …in handleWsMessage's switch, before `default`:
    case "run-updated":
      callbacks.onRunUpdated?.(msg.runId)
      break
    case "run-records":
      callbacks.onRunRecords?.(msg.runId, msg.recCount)
      break
```

…and thread both through `useWebSocket` exactly as `onReload` is threaded: a ref per callback, an effect keeping it current, and reading off the ref inside `ws.onmessage` — so a callback swap never recreates the socket.

- [ ] **Step A2: Thread `runsEnabled` through the config client**

`ServerConfig` in `frontend/src/lib/api-client.ts` and `DEFAULT_CONFIG` in `frontend/src/hooks/use-config.ts` both gain `runsEnabled: boolean`, defaulting to **false**. The existing comment on that hook states the rule this follows: safe defaults apply while loading and on failure, so the affordance stays hidden unless the server explicitly says otherwise.

- [ ] **Step A3: Add the `AppView` switch and route to an empty Runs view**

Write the failing tests first (`frontend/tests/agent-runs-entrypoint.test.tsx`), one at a time, per the list above — visibility, badge arithmetic, and hash behaviour are the seams; the markup is not.

Then implement:

```tsx
// frontend/src/App.tsx — NOT ViewMode, which already means the file-type filter
type AppView = "docs" | "runs"

const RUN_TERMINAL: readonly RunStatus[] = ["done", "failed", "stopped"]
export function activeRunCount(runs: readonly RunMeta[]): number {
  return runs.filter((r) => !RUN_TERMINAL.includes(r.status)).length
}
```

`AppSidebar` takes `appView`, `onAppViewChange`, `runsEnabled` and `activeRunCount`, and renders the segmented switch immediately after the logo row — above the file filter, so it reads as a view change rather than another filter. Reuse the existing segmented-control markup at `app-sidebar.tsx:169-192` for visual consistency, but keep it a separate control.

`App.tsx` derives `AppView` from the hash, remembers the last docs hash in a ref, and renders `<RunsView>` instead of the docs layout when in runs. On mobile, the drawer's content switches on `AppView` too.

- [ ] **Step A4: Verify in the running app, then commit A**

With the dev server up, confirm by eye at `http://localhost:5173`:
1. The `Docs | Runs` switch is present, with **no** badge (zero runs).
2. Clicking `Runs` navigates to `#/runs` and shows the empty state — not a blank panel.
3. Clicking `Docs` returns to the doc you were reading, not the root.
4. The mobile drawer (narrow the window) shows the same switch.
5. `VIBEDOCS_RUNS_ENABLED=false` restart → the switch is gone entirely.

```bash
npx vitest run frontend/tests/agent-runs-entrypoint.test.tsx
npm run build      # frontend typecheck must pass
git add frontend/src CONTEXT.md frontend/tests/agent-runs-entrypoint.test.tsx
./scripts/check-public-safe.sh
git commit -m "feat(agent-runs): sidebar view switch and empty Runs view

Adds an AppView switch (Docs | Runs) at the top of the sidebar header, visible
only when the server reports runsEnabled. Deliberately NOT named ViewMode: that
type already exists for the file-type filter in the same header and means a
different axis entirely.

Always visible when the feature is enabled, badge-free at zero runs — being able
to tell 'enabled but empty' from 'broken' is worth more than the tidier empty
UI. Returning to Docs restores the previous doc rather than the root.

Assisted-by: Claude Opus 5"
```

- [ ] **Step B1: Write the display helpers**

Create `frontend/src/agent-runs/lib/tool-display.ts`:

```ts
import type { AgentEvent, ToolInfo } from "@shared/agent-run-types"

export function fmtTime(ms?: number): string {
  if (!ms) return ""
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

export function fmtDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ""
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

/**
 * Paths display relative to the run's workdir. Absolute paths are unreadable in
 * a narrow gutter and every one of them starts with the same 60 characters.
 */
export function shortenPath(p: string, workdir?: string): string {
  if (!p) return ""
  const root = workdir?.replace(/\/$/, "")
  if (root && p.startsWith(root + "/")) return p.slice(root.length + 1)
  return p.replace(/^\/(?:Users|home)\/[^/]+\//, "~/")
}

export function toolSummary(tool: ToolInfo): string {
  if (tool.status === "running") return "running"
  if (tool.linesAdded != null || tool.linesRemoved != null) {
    return `+${tool.linesAdded ?? 0} / -${tool.linesRemoved ?? 0}`
  }
  if (tool.exitCode != null) return `exit ${tool.exitCode}`
  return tool.status === "error" ? "error" : "done"
}

/** Language guess for highlighting a tool's output. */
export function toolLang(tool: ToolInfo): string {
  const p = String(tool.args?.path ?? tool.args?.file_path ?? "")
  if (/\.tsx?$/.test(p)) return "typescript"
  if (/\.jsx?$/.test(p)) return "javascript"
  if (/\.go$/.test(p)) return "go"
  if (/\.py$/.test(p)) return "python"
  if (/\.sh$/.test(p)) return "bash"
  if (/\.ya?ml$/.test(p)) return "yaml"
  if (/\.json$/.test(p)) return "json"
  if (/\.md$/.test(p)) return "markdown"
  if (tool.name === "shell") return "bash"
  return "text"
}

/** What the row's copy button yields. */
export function toolCopyText(event: AgentEvent): string {
  const tool = event.tool
  if (!tool) return event.text ?? ""
  const parts = [`$ ${tool.label}`]
  if (tool.exitCode != null) parts.push(`exit ${tool.exitCode}`)
  if (tool.output) parts.push(tool.output)
  return parts.join("\n")
}

/** One-line title for any event kind. */
export function eventTitle(event: AgentEvent, workdir?: string): string {
  switch (event.kind) {
    case "tool": {
      const t = event.tool!
      const isPath = t.args?.path != null || t.args?.file_path != null
      return isPath ? shortenPath(t.label, workdir) : t.label
    }
    case "thinking":
      return `Reasoning · ${(event.text ?? "").split(/\s+/).filter(Boolean).length} words`
    case "user":
      return "Brief dispatched"
    case "init":
      return `Session ${String(event.meta?.sessionId ?? "").slice(0, 8)} · ${String(event.meta?.model ?? "")}`
    case "result":
      return event.meta?.isError ? "Turn failed" : "Turn complete"
    case "assistant":
      return event.text ?? ""
    default:
      return `${event.meta?.vendorType ?? "event"}/${event.meta?.vendorSubtype ?? ""}`
  }
}
```

- [ ] **Step B2: Write the record-paging hook**

`use-runs.ts` already exists from Commit A (the rail count needs it). For reference, that hook is:

```ts
import { useCallback, useEffect, useState } from "react"
import type { RunMeta } from "@shared/agent-run-types"

export function useRuns() {
  const [runs, setRuns] = useState<RunMeta[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    fetch("/api/runs")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body) => setRuns(body.data ?? []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])
  return { runs, loading, refresh }
}
```

Create the new one, `frontend/src/agent-runs/hooks/use-run-records.ts`. The key property: it pages by record position and folds incrementally, so a WS nudge fetches only the tail and reconnect catch-up is the same call.

```ts
import { useCallback, useEffect, useRef, useState } from "react"
import { applyRecords, type AgentEvent, type RunMeta } from "@shared/agent-run-types"

export function useRunRecords(runId: string | null) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [meta, setMeta] = useState<RunMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Records consumed so far — the paging cursor, kept in a ref so fetchTail is stable. */
  const recCount = useRef(0)

  const fetchTail = useCallback(async () => {
    if (!runId) return
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/events?fromRec=${recCount.current}`)
      if (!res.ok) throw new Error(`events ${res.status}`)
      const { data } = await res.json()
      if (!data.records?.length) return
      recCount.current = data.recCount
      // Incremental fold: a patch may target an event from an earlier page,
      // which is exactly why paging is by record and not by event seq.
      setEvents((prev) => applyRecords(prev, data.records))
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load events")
    }
  }, [runId])

  const refreshMeta = useCallback(async () => {
    if (!runId) return
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`)
      setMeta(res.ok ? (await res.json()).data : null)
    } catch {
      setMeta(null)
    }
  }, [runId])

  // Reset everything when the selected run changes — stale events from the
  // previous run must never fold into the new one.
  useEffect(() => {
    recCount.current = 0
    setEvents([])
    setMeta(null)
    setError(null)
    if (!runId) return
    setLoading(true)
    Promise.all([refreshMeta(), fetchTail()]).finally(() => setLoading(false))
  }, [runId, refreshMeta, fetchTail])

  return { events, meta, loading, error, fetchTail, refreshMeta }
}
```

- [ ] **Step B3: Write the icon and copy primitives**

Create `frontend/src/agent-runs/components/StatusIcon.tsx`, `ToolIcon.tsx`, `KindIcon.tsx`, `CopyButton.tsx`. lucide only, no emoji. Suggested mapping — `running` → `Loader2` with `animate-spin`, `idle` → `Circle`, `waiting` → `Clock`, `blocked` → `OctagonAlert`, `done` → `CircleCheck`, `failed` → `CircleX`, `stopped` → `CircleStop`; tools — `shell` → `Terminal`, `read` → `FileText`, `edit` → `FilePen`, `grep` → `Search`, `glob` → `FolderSearch`, default `Wrench`; kinds — `init` → `Play`, `user` → `MessageSquare`, `thinking` → `Brain`, `assistant` → `Sparkles`, `result` → `Flag`, `other` → `Dot`.

`CopyButton` is the bake-off's, retyped against this repo's `Button` primitive and `cn`:

```tsx
import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

export function CopyButton({ value, label, className, title = "Copy" }: {
  value: string | (() => string)
  label?: string
  className?: string
  title?: string
}) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(typeof value === "function" ? value() : value)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className={cn(
        "tap-target inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs",
        "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span>{done ? "Copied" : label}</span>}
    </button>
  )
}
```

`CodeBlock` in this slice renders **plain preformatted text** with a copy button and a wrap toggle — no highlighting. Server-side output highlighting is Task 16; adding a client-side highlighter here would violate the global constraint.

- [ ] **Step B4: Write TimelineRow, Timeline, RunRail, RunHeader, RunsView**

`TimelineRow` is the port of `V2Timeline`'s `Row`, with three changes: markdown-bearing kinds render `event.textHtml` through `dangerouslySetInnerHTML` (already sanitized server-side) instead of plain text; tool labels shorten against `workdir`; and it uses this repo's `Collapsible` from `@/components/ui/collapsible` rather than importing radix directly.

```tsx
// frontend/src/agent-runs/TimelineRow.tsx — the markdown branch, which is the
// part that differs from the bake-off reference:
{event.kind === "result" && (
  event.textHtml
    ? <div className="prose prose-sm dark:prose-invert mt-1 max-w-none"
           dangerouslySetInnerHTML={{ __html: event.textHtml }} />
    : <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{event.text}</div>
)}
```

The same branch applies to `assistant` and to the expanded `user` brief. `thinking` stays `whitespace-pre-wrap` plain text — it is raw reasoning, not markdown, and Task 8 deliberately does not render it.

`Timeline` maps events to rows inside a `ScrollArea` with the absolute vertical spine (`V2Timeline.tsx:17`). `RunRail` groups active runs above done ones, each row showing title, one-line description, a `StatusIcon`, and its links. `RunHeader` shows identity and links. `RunsView` composes rail + detail in a `ResizablePanelGroup`, matching the docs layout.

- [ ] **Step B5: Wire live updates into the populated view**

Routing, the switch and `#/runs/:id` parsing all landed in Step A3 — do not redo them here. What remains is replacing `RunsView`'s empty state with rail + detail once runs exist, and connecting the WebSocket:

- `onRunUpdated(runId)` — refresh the rail, and the open run's meta if the id matches.
- `onRunRecords(runId, recCount)` — call `fetchTail()` when the id matches the open run. The nudge carries a count, not a payload, so this is the same `?fromRec=` call the initial load makes.

Keep the empty state as the zero-runs branch; it is the normal state of a freshly enabled server, not an error.

- [ ] **Step B6: Write a rendering test**

Create `frontend/tests/agent-runs-timeline-row.test.tsx` asserting: an assistant event with `textHtml` renders an `<h2>` and not the literal `##`; a tool event renders its label, status icon and summary; a running tool shows the running state; a tool path label is shortened against `workdir`; and an event with neither text nor tool renders without throwing.

- [ ] **Step B7: Verify the whole slice against a real transcript**

```bash
npm run build            # frontend typecheck + build must pass now
VIBEDOCS_RUNS_ENABLED=true VIBEDOCS_RUNS_TOKEN=$(openssl rand -hex 16) npm run dev
# in another shell, with the same token:
node scripts/replay-transcript.mjs <local-transcript>/events.ndjson --id demo --delay 200 --workdir /path/to/checkout
```

Open `http://localhost:5173/#/runs/demo`. Confirm, by eye:

1. The rail lists the run with a status icon and no emoji anywhere.
2. Markdown **renders** — headings, lists, bold, fenced code — not raw `##` and `**`.
3. Tool rows collapse to one line and expand to show output.
4. Paths display relative to the workdir, not as 60-character absolutes.
5. New events appear as the replay streams (`--delay 200` makes this visible).
6. No console errors, and no `Invalid Date` or absurd durations in the gutter — that was the bake-off's missing-timestamp bug and Task 2 fixes it upstream of here.

- [ ] **Step B8: Full verify and commit**

Run: `npm run verify` — CI's gate, in CI's order.

```bash
git add frontend/src/agent-runs frontend/src/App.tsx frontend/src/hooks/use-websocket.ts \
        frontend/src/hooks/use-config.ts frontend/tests/agent-runs
./scripts/check-public-safe.sh   # gate: must exit 0
git commit -m "feat(agent-runs): timeline transcript view, rail, and hash route

Closes the vertical slice: push a run and read it at #/runs/:id. The route uses
a leading slash so it cannot collide with a project literally named 'runs'.

Records page by position and fold incrementally, so a WS nudge fetches only the
tail and reconnect catch-up is the same call. Markdown arrives pre-rendered from
the server; the client adds no markdown or highlighting library.

Follow mode, filters and virtualization are deliberately absent — each is a
separate reviewable change.

Assisted-by: Claude Opus 5"
```

---

**Phase A is done when:** a real multi-megabyte transcript replays into a running server and renders as a readable timeline with real markdown, `npm run verify` is green, and the stored run directory is a small fraction of the source file.

---

# Phase B — widen

Nine changes, each independently reviewable and each landing on a working app. Ordered so the ones Daniel called out specifically come first.

### Task 10: Follow mode, anchored at the bottom

He called this out specifically, and the spec is explicit that getting release/re-pin right matters more than the animation: *"a view that snatches the scroll back while you're reading is worse than no follow mode."*

Extract the decision into a **pure reducer** so it can be tested without a scroll container.

**Files:** create `frontend/src/agent-runs/hooks/use-follow-mode.ts` and `frontend/tests/agent-runs-follow-mode.test.ts`; modify `Timeline.tsx`.

**Produces:**
- `type FollowState = { pinned: boolean; showJumpButton: boolean }`
- `type FollowAction = { type: 'scrolled'; distanceFromBottom: number } | { type: 'events-appended' } | { type: 'jump-clicked' } | { type: 'run-changed' }`
- `followReducer(state, action, opts: { threshold: number }): FollowState`
- `useFollowMode(runId, eventCount)` returning `{ pinned, showJumpButton, onScroll, jumpToLatest, scrollRef }`

Required test cases: opening a run starts pinned with no jump button; appending while pinned keeps it pinned; scrolling up past the threshold releases the pin and shows the button; scrolling back to within the threshold re-pins and hides it; appending while released does **not** re-pin and does **not** move the viewport; clicking jump re-pins and hides the button; changing run resets to pinned; and a scroll event whose distance is exactly the threshold counts as at-bottom (boundary).

### Task 11: The filter bar

Merge bake-off v6's toolbar into the timeline: a text filter over command text and output, plus `all` / `tools` / `failures` / `narrative`.

**Files:** create `frontend/src/agent-runs/FilterBar.tsx` and `lib/filter-events.ts` + tests; modify `Timeline.tsx`.

**Produces:** `type QuickFilter = 'all' | 'tools' | 'failures' | 'narrative'` and `filterEvents(events, { query, quick }): AgentEvent[]`.

Keep the predicate pure and separate from the component. Test: `tools` keeps only tool events; `failures` keeps tool errors **and** results with `meta.isError`; `narrative` keeps assistant/user/result; the text query matches tool label and tool output and event text, case-insensitively; an empty query matches everything; and filtering does not renumber or reorder.

### Task 12: Virtualization

`react-virtuoso`, the one sanctioned new dependency. Must be verified against the largest local transcript (1973 events), not a small fixture.

**Files:** modify `Timeline.tsx`; add `frontend/package.json` dependency.

The hard part is the interaction with Task 10: Virtuoso has its own `followOutput` and `atBottomStateChange`, and wiring both it and a custom scroll handler produces fighting scroll anchors. Drive the pin from Virtuoso's `atBottomStateChange` and pass `followOutput={pinned ? 'smooth' : false}`; the reducer stays the source of truth for `showJumpButton`.

Verification is a measurement, not an assertion: replay the 1973-event transcript, then confirm scrolling to the end stays responsive and the DOM node count stays bounded (spot-check in devtools that rendered rows number in the tens, not the thousands). Record the numbers in the commit message.

### Task 13: Config-driven linkification

**Files:** create `frontend/src/agent-runs/lib/linkify.ts`, `components/Linked.tsx`, `hooks/use-runs-config.ts` + tests.

Port the bake-off's `linkify` (`lane.ts:143-179`) but drive it from `GET /api/runs/config` instead of the hardcoded `linkConfig`. Keep the overlap resolution (earliest-and-longest wins) — it is the non-obvious part. Add the editor-scheme path links and the rail's clickable issue key.

Test: rules from config produce links; `$1` substitution works; overlapping matches resolve earliest-and-longest; a rule with a dangerous scheme never produces an href (defense in depth — the server already drops it); text with no matches returns a single plain segment; and linkified output inside rendered markdown does not double-link an existing `<a>`.

### Task 14: The command queue

**Files:** create `src/agent-runs/commands.ts`, extend `routes.ts`, create `tests/agent-runs-commands.test.ts`.

`POST /api/runs/:id/commands` (same-origin) enqueues; `GET /api/runs/:id/commands` long-polls with a timeout and returns queued commands; `POST /api/runs/:id/commands/:cmdId/ack` (bearer) marks it acked. Vocabulary is `stop` only — never free-text.

Test: queue → poll → ack → `stopRequested` clears; a long-poll with nothing queued returns empty after the timeout rather than hanging forever; an unacked command stays queued across polls; acking an unknown command id 404s; enqueuing an unknown command kind 400s; and the poll requires the bearer token while the enqueue requires same-origin.

### Task 15: Lifecycle buttons

**Files:** modify `RunHeader.tsx`; create `frontend/tests/agent-runs-lifecycle.test.tsx`.

Mark merged / failed / waiting are plain `PATCH {status}`. Stop posts a command and shows `stop requested` until the ack lands. Test the optimistic-update-then-reconcile path and the failure path (a rejected PATCH must roll the button back, not leave a lying status).

### Task 16: Server-side output highlighting

**Files:** add `GET /api/runs/:id/events/:seq/output` returning highlighted HTML for one tool's output; modify `CodeBlock.tsx` to fetch lazily on expand.

Lazy by design: output can be 256 KB and most rows are never expanded. Reuses `createAgentTextProcessor`'s shiki instance via a small `highlightCode(code, lang)` helper. Cap and reuse the same truncation marker as Task 2.

### Task 17: The frontend-design pass

Daniel asked for this specifically, on the run header and the rail rows — the bake-off header crams ticket, description, PR link and three buttons into one strip, and the rail rows stack four lines at three weights.

**Invoke the `frontend-design` skill** for this task rather than hand-tweaking. Scope it to exactly those two surfaces. Constraints carry: lucide only, no emoji, existing `components/ui/` primitives, no rival design system, and both light and dark themes must be checked.

### Task 18: Documentation

**Files:** create `docs/agent-runs.md`; modify `CLAUDE.md`.

`docs/agent-runs.md` covers the API contract a client must meet (the same table as Task 7, plus the command poll loop), the `agent-runs.json` config shape with **neutral example URLs**, and the three-seam architecture with a note on how to add an adapter.

`CLAUDE.md` gains `VIBEDOCS_RUNS_ENABLED`, `VIBEDOCS_RUNS_DIR`, `VIBEDOCS_RUNS_TOKEN` in the config table, the auth-split rule in Key Patterns, and a Gotcha for the two traps in this build: **paging is by record, not by event seq** (a patch can target an event older than the page), and **`/api/runs/config` must stay registered before `/api/runs/:id`** or it resolves as a run id.

Run the constraint gate over both files before committing — this is the task most likely to reintroduce a real tracker URL as an "example".

---

### Task 19: Squash and open the PR

The only task that touches the network. Everything before it is local.

**Do not start this until Tasks 1–18 are all committed and `npm run verify` is green.** The squash is irreversible in the sense that the per-task history is discarded — that is the point, but it means the branch should be in its final state first.

- [ ] **Step 1: Confirm the branch is complete and clean**

```bash
cd /Users/dabright/Development/external-public/vibedocs
BASE=$(cat .git/agent-runs-base)
git log --oneline "$BASE"..HEAD          # expect ~18 commits, one per task
git status --short                        # expect empty
git log --oneline origin/main..HEAD --not --remotes   # expect all of them: nothing pushed yet
```

If anything is already pushed, stop — the squash would become a force-push over a published branch. Say so rather than forcing.

- [ ] **Step 2: Run the full gate one last time, pre-squash**

```bash
npm run verify        # build:cli + typecheck + build + both suites, in CI's order
```

Expected: green. This is the "am I done?" command; a green `verify` means CI will be green for the same reasons.

- [ ] **Step 3: Squash to a single commit**

`reset --soft` back to the recorded branch point leaves every change staged and the working tree untouched, so the squash cannot lose work.

```bash
BASE=$(cat .git/agent-runs-base)
git reset --soft "$BASE"
git status --short          # everything staged, nothing unstaged
```

- [ ] **Step 4: Run the leak gate against the entire branch at once**

This is the highest-value moment for the gate. Until now it has only ever seen one task's diff; after the soft reset the **whole feature** is staged, so a single run covers every file the branch touches.

```bash
./scripts/check-public-safe.sh    # must print "public-safe: clean"
```

If it blocks, fix the file, `git add` it, and re-run. Do not commit past a block.

- [ ] **Step 5: Verify the identity that will author the squashed commit**

The squashed commit takes the *current* config, so this is the one that ends up in public history.

```bash
git config user.email    # must print danielcbright@gmail.com
git config user.name     # must print Daniel Bright
```

- [ ] **Step 6: Commit**

```bash
git commit -F- <<'MSG'
feat(agent-runs): live viewer for headless agent runs

Adds an Agent Runs feature alongside the docs browser: a lane rail and a
streaming timeline transcript, fed entirely over HTTP by an external dispatch
client. Vendor-neutral — the server knows nothing about any particular agent,
issue tracker or repository host; those live in ~/.vibedocs/agent-runs.json and
in the client.

Three seams:
  - ingest   (src/agent-runs/)         validates and persists API writes
  - adapters (src/agent-runs/formats/) normalize vendor JSON to one event shape
  - view     (frontend/src/agent-runs/) renders canonical events only

Storage is files on disk, no database: meta.json plus an append-only
events.ndjson per run. Because the log cannot be rewritten, a tool call appends
on start and is patched on completion, so a running tool is visible while it
runs; one shared fold reconciles the log, and paging is by record position
rather than event seq because a patch can target an event from an earlier page.

The cursor-stream-json adapter is written against real captured transcripts.
The non-obvious rules: call_id carries an embedded newline; four event types
routinely carry no timestamp at all and are server-stamped; failures are a
separate result discriminator carrying exitCode/stdout/stderr rather than a
malformed success; and edit results carry the entire file twice, which is
dropped so canonical storage stays a fraction of raw.

Writes are split by threat model. Ingest takes a bearer token. Control writes
(status changes, stop requests) come from the browser, which has no secret and
is never given one, so they are gated same-origin instead. Stop records intent
into a small closed command queue that the owning client polls and acks — the
server never executes anything.

Markdown renders through the project's existing unified pipeline; no
react-markdown and no client-side highlighter. The feature is off unless
VIBEDOCS_RUNS_ENABLED is set.

Assisted-by: Claude Opus 5
MSG
```

Check the trailers: `Assisted-by:` present; **no** `Co-Authored-By:`; **no** `Claude-Session:`.

- [ ] **Step 7: Push, as the right account**

`git` does not read `GH_TOKEN` — it uses the per-clone credential helper configured in Global Constraints. Confirm the resolution before pushing, because the failure mode is a confusing permissions error rather than an obvious identity one.

```bash
printf 'protocol=https\nhost=github.com\n\n' | git credential fill | grep '^username='   # username=danielcbright
git push -u origin feat/agent-runs
```

- [ ] **Step 8: Draft the PR body, and get Daniel's sign-off before opening it**

**Do not open the PR unilaterally.** Draft the body, show it to Daniel, and use his edits verbatim. This repo has no `.github/PULL_REQUEST_TEMPLATE.md` (checked 2026-08-12), so use a plain structure: what it adds, the three design decisions a reviewer needs, how it was tested, and how to try it.

Two things the body must not do: claim CI is green before it actually is, and describe the reference transcripts by name or path. Describe them as "real captured transcripts" and quote only the measured numbers.

Once he approves, open it with the account passed inline:

```bash
GH_TOKEN=$(gh auth token --user danielcbright) gh pr create \
  --repo danielcbright/vibedocs \
  --base main \
  --head feat/agent-runs \
  --title "feat(agent-runs): live viewer for headless agent runs" \
  --body-file /path/to/approved-body.md
```

Then report the PR URL. Do not merge it.

- [ ] **Step 9: Clean up the marker**

```bash
rm -f .git/agent-runs-base
```

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: architecture/seams → 2, 3, 6; storage → 3; canonical event shape → 1, 2; API table → 7, 14; status vocabulary → 1, 7; links → 1, 7, 13; lifecycle buttons → 14, 15; timeline layout → 9; markdown rendering → 8; follow mode → 10; filter bar → 11; copy affordances → 9, 16; virtualization → 12; linkification → 13; the rail → 9, 13; visual polish → 17; client contract → 18; testing → every task; out-of-scope items stay out.

**Three gaps the spec had, resolved here:** browser control writes had no auth path (Task 5); tool merge was impossible against an append-only file without losing live visibility (Task 1's record log); and the markdown pipeline could not be reused as-is (Task 8).

**Open risk to watch during execution.** Task 12's virtualization is the one item whose approach could still be wrong — Virtuoso's `followOutput` and the Task 10 reducer both want to own the scroll anchor, and the interaction is easier to get wrong than to test. If they fight, the fallback is to let Virtuoso own pinning entirely and reduce Task 10's reducer to deriving `showJumpButton` from `atBottomStateChange`. Decide it with the 1973-event transcript in front of you, not in the abstract.

Then Phase B: follow mode, filter bar, virtualization, config-driven linkify, command queue, lifecycle buttons, server-side output highlighting, the frontend-design pass, and docs.
