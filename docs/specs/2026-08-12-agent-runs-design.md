# VibeDocs Agent Runs — design

> Status: approved 2026-08-12 by Daniel. Supersedes the cmux-workspace lane viewer that
> `cursor-dispatch.sh` drives today.
> Reference implementation and component research: kept outside this repo (local notes).

## The problem

Headless `cursor-agent` lanes are dispatched by `cursor-dispatch.sh` (start / follow / status /
watch / stop). Watching one today means a cmux workspace tailing `events.ndjson` through
`render-lane.py` over an SSH bridge, and reading a lane's outcome means scrolling a frozen
terminal pane. It is plain text: no clickable Jira or PR links, no scrollback worth the name, no
way to expand a truncated tool result, and the SSH/surface choreography behind it is the most
fragile part of the dispatch wrapper.

## What we're building

A generic **Agent Runs** feature inside VibeDocs: a second view alongside the docs browser that
shows agent runs as they work — a lane rail on the left, a live transcript on the right — fed
entirely through an HTTP API. VibeDocs knows nothing about the dispatch client or any issue tracker; clients push runs and events to it, and
configuration supplies the link targets.

This replaces the cmux workspace machinery **entirely**. `cursor-dispatch.sh` stops creating
workspaces, stops the SSH watch bridge, stops the emoji state machine, and instead POSTs to the
API. `watch`/`open-watch`/`close-watch` collapse into "open this URL".

## Architecture

```
cursor-dispatch.sh                    vibedocs server (Hono)              browser
  start  ──► POST /api/runs ──────────►  write meta.json               ──► WS push
  (tail) ──► POST /api/runs/:id/events►  append events.ndjson          ──► WS push
  status ──► PATCH /api/runs/:id ─────►  update meta.json              ──► WS push
             GET /api/runs/:id/commands ◄── queued stop request  ◄──────── Stop button
```

Three seams, each independently testable:

1. **Ingest** (`src/agent-runs/ingest.ts`) — validates and persists API writes. Knows nothing
   about rendering.
2. **Format adapters** (`src/agent-runs/formats/`) — normalize a vendor event into the app's
   canonical event shape. `cursor-stream-json` is the only adapter in this release; Claude Code
   JSONL is the next one and must not require touching ingest or the UI.
3. **View** (`frontend/src/agent-runs/`) — renders canonical events. Never parses vendor JSON.

### Storage

Files on disk, no database — consistent with the rest of VibeDocs. Under a configurable data
root (default `~/.vibedocs/runs/`), one directory per run:

```
<runId>/meta.json      run identity, status, links, timestamps
<runId>/events.ndjson  append-only canonical events, one JSON object per line
```

Runs are kept forever and are searchable. `meta.json` is rewritten on each status change;
`events.ndjson` is only ever appended to.

### Canonical event shape

The adapter's output, and the only thing the frontend sees:

```ts
type AgentEvent = {
  seq: number            // server-assigned, monotonic per run
  ts: number             // epoch ms; server-stamped when the client omits it
  kind: 'init' | 'user' | 'thinking' | 'assistant' | 'tool' | 'result' | 'other'
  text?: string          // user/assistant/thinking/result body — markdown for assistant+result
  tool?: {
    name: string         // 'shell' | 'read' | 'edit' | 'grep' | …
    callId: string
    label: string        // one-line display form (command, or path relative to cwd)
    args: Record<string, unknown>
    status: 'running' | 'success' | 'error'
    exitCode?: number
    output?: string
    linesAdded?: number
    linesRemoved?: number
    endTs?: number
  }
  meta?: Record<string, unknown>  // durationMs, tokens, sessionId, model — kind-specific
}
```

Two normalization rules the cursor adapter must implement, both learned from real transcripts:

- **Coalesce `thinking` deltas.** Cursor emits a `thinking/delta` per token and a
  `thinking/completed` terminator. Collapse a delta run into one `thinking` event.
- **Merge tool `started` + `completed` into one event** keyed by `call_id`, carrying the final
  status, exit code and output. The UI must never see half a tool call. Note that cursor's
  `call_id` contains an embedded newline — split on it and keep the first segment.

Also: `system/init` and `result` events carry **no timestamp** in cursor's stream. The server
stamps them on arrival; consumers must not assume `ts` exists on client-supplied events.

### API

Writes require a bearer token, reads are open on loopback — the same opt-in pattern as the
existing upload endpoint (`src/upload-auth.ts`). Reuse that module rather than inventing a
second auth path.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/runs` | Register a run. Body: `{id?, title, description, status, links[], format, agent, workdir?}`. Returns `{id, url}`. |
| `POST` | `/api/runs/:id/events` | Append events. Body: `{format, events: [...]}` — raw vendor lines, batched. Idempotent on `(runId, clientSeq)`. |
| `PATCH` | `/api/runs/:id` | Update status, title, description, or links. Partial. |
| `GET` | `/api/runs` | List runs (rail data): id, title, status, links, timestamps. |
| `GET` | `/api/runs/:id` | Run meta. |
| `GET` | `/api/runs/:id/events?from=<seq>` | Event page, for initial load and reconnect catch-up. |
| `GET` | `/api/runs/:id/commands` | **Client** long-polls for queued control commands (see below). |
| `POST` | `/api/runs/:id/commands/:cmdId/ack` | Client reports a command's outcome. |

**Status vocabulary** (generic — no cursor or Jira semantics): `running`, `idle`, `blocked`,
`waiting`, `done`, `failed`, `stopped`. `waiting` is the "finished its turn but the work isn't
landed" state — what a client's "finished but unlanded" state maps to. The client owns the meaning; VibeDocs only
renders it.

**Links** are `{label, url, kind}` where `kind` is a display hint (`issue`, `pr`, `ci`, `other`)
that selects the lucide icon. The dispatch wrapper supplies the actual Jira/GitHub URLs — VibeDocs
never constructs them.

### Lifecycle buttons

This was the open question, and it splits cleanly in two:

- **Mark merged / mark failed / mark waiting are pure state writes.** They are `PATCH
  /api/runs/:id {status}` and involve no process at all. Trivial, generic, safe. Build these.
- **Stop is different** — VibeDocs does not own the agent process and may not even be on the same
  machine, so it cannot kill anything. It records **intent**: the button POSTs a `stop` command,
  which sits in the run's command queue until the owning client picks it up via
  `GET /api/runs/:id/commands` and acts on it (`cursor-dispatch.sh stop <lane>`), then acks.
  The UI shows `stop requested` until the ack arrives, then the status the client reports.

This keeps the server free of an arbitrary-exec endpoint while still giving Daniel a working Stop
button. It also generalizes: any future agent client can implement the same tiny poll loop.
Commands are a small, closed vocabulary (`stop` in this release) — never free-text shell.

## The transcript view

**Timeline layout** (the timeline variant of the local layout bake-off, which has a working
reference implementation). A single vertical rail with a monospace timestamp gutter; every event is
a node with a lucide icon. Reasoning and tool calls collapse to one line and expand in place; the
narrative flows down the spine. Chronology is the organizing principle, which is what makes it
correlate with CI timings and PR events.

Requirements:

- **Markdown rendering.** Assistant messages and the final result are markdown and must render as
  markdown — headings, lists, code fences, bold. Reuse VibeDocs' existing server-side pipeline
  (`src/markdown-processor.ts`: remark → rehype → `rehype-sanitize` → `@shikijs/rehype`). Do not
  add `react-markdown` or a client-side highlighter; that duplication is exactly what the
  component research ruled out. Tool output stays preformatted, highlighted by language guessed
  from the tool's path/kind.
- **Follow mode, anchored at the bottom.** Opening a run lands you at the newest event, not the
  oldest, and new events push the view down while you stay pinned. Scrolling up releases the pin
  and reveals a floating "Jump to latest" affordance at the bottom; clicking it re-pins and
  resumes following. Getting the release/re-pin behavior right matters more than the animation —
  a view that snatches the scroll back while you're reading is worse than no follow mode.
- **Filter bar from the activity-table variant.** Above the timeline: a text filter over
  command text and output, plus quick filters (all / tools / failures / narrative). Same
  behavior as bake-off v6's toolbar, applied to the timeline rows.
- **Copy affordances on every node**: copy command, copy text, copy code (in expanded output),
  plus a wrap/nowrap toggle on code blocks.
- **Virtualization.** 141 events is fine unvirtualized; a long lane is not. Use a virtualizer
  (react-virtuoso is the researched choice) sized to the real event counts, and verify against a
  1MB+ transcript — not the demo fixture.

### Linkification

Config-driven, never hardcoded. A `links` config block declares patterns → URL templates:

```json
{
  "agentRuns": {
    "linkify": [
      { "pattern": "\\b([A-Z][A-Z0-9]+-\\d+)\\b", "url": "https://tracker.example.com/browse/$1", "kind": "issue" },
      { "pattern": "\\bPR #(\\d+)\\b", "url": "https://github.com/org/repo/pull/$1", "kind": "pr" },
      { "pattern": "\\brun `?(\\d{9,})`?", "url": "https://github.com/org/repo/actions/runs/$1", "kind": "ci" }
    ],
    "editorScheme": "cursor://file"
  }
}
```

File paths in tool calls link to the configured editor scheme. Paths display relative to the run's
`workdir` — full absolute paths are unreadable in a narrow gutter and every one of them starts
with the same 60 characters. Linkified output must still go through sanitization; treat all agent
text as untrusted.

### The rail

Sidebar + detail, mirroring the cmux layout being replaced, using lucide icons for status —
**no emoji anywhere**. Groups: active runs above, done below. Each row shows title, one-line
description, status, and links.

- **The issue key in the rail is itself a link**, not just the one in the detail header. Clicking
  the row selects the run; clicking the key opens the configured issue URL.
- Status icons: `running` (spinner), `idle`, `waiting`, `blocked`, `done`, `failed`, `stopped`.

### Visual polish

Invoke the **frontend-design** skill for the run header and the rail rows specifically. The
bake-off header crams ticket, description, PR link and three action buttons into one strip and it
reads as cluttered; the rail rows stack four lines of metadata at three different weights. Both
want a considered pass rather than another round of ad-hoc tweaks.

## Client changes (`cursor-dispatch.sh`)

Out of scope for the VibeDocs repo, but the contract the wrapper must meet:

- `start` → `POST /api/runs`, then stream `events.ndjson` lines to `POST /api/runs/:id/events` as
  they are written (batched, ~250ms or 64 lines, whichever first).
- Lifecycle lines it already writes to its own status file additionally `PATCH` the run status.
- `PR #N` detection already in the wrapper becomes a `links` PATCH.
- A background poller on `GET /api/runs/:id/commands` executes queued `stop` and acks.
- Everything cmux: `open-watch`, `close-watch`, `mark-done`, `mark-failed`, `set-pr`, the
  `.group-{active,done}` files, the SSH bridge — deleted. `watch` prints the run URL.

## Upstream PR

The feature ships vendor-neutral so it can go back to `danielcbright/vibedocs`: no Jira, no
GitHub Enterprise, no cursor-dispatch specifics in the code — those live in config and in the
client. New dependencies must stay near zero; the transcript UI composes the `components/ui/`
primitives already present (Collapsible, ScrollArea, Card, Badge, Button, Command) in the
prompt-kit style, plus a virtualizer. Do not import a rival design system.

## Testing

- **Adapter unit tests** against fixtures synthesized from real captured cursor events:
  delta coalescing, tool started/completed merge, the
  newline-in-`call_id` case, missing timestamps, and a `result` event whose body is empty on a
  resumed turn.
- **Ingest tests**: auth rejection, idempotent replay of the same batch, out-of-order arrival.
- **Command queue tests**: queue → poll → ack → status transition, and an unacked command.
- **Frontend tests**: follow-mode pin/release/re-pin, filter behavior, markdown rendering of an
  assistant message, and rendering a run with zero events.
- Verify against a real 1MB transcript, not the 141-event demo fixture.

## Explicitly out of scope

Composing prompts or dispatching new runs from the browser; Claude Code and other adapters;
multi-user auth beyond the loopback bearer token; hosting VibeDocs anywhere but localhost.
