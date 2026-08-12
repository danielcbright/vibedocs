# Agent Runs

A live viewer for headless coding-agent runs: a lane rail in the sidebar, a
streaming transcript beside it. Clients push runs and events over HTTP; VibeDocs
stores and renders them and knows nothing about any particular agent, issue
tracker or repository host.

The feature is **off by default**. Nothing in this document applies until
`VIBEDOCS_RUNS_ENABLED` is set.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `VIBEDOCS_RUNS_ENABLED` | `false` | Master switch. When falsy, every `/api/runs*` route returns 404 and no Runs affordance appears in the UI. |
| `VIBEDOCS_RUNS_DIR` | `~/.vibedocs/runs` | Where run data lives. One directory per run. |
| `VIBEDOCS_RUNS_TOKEN` | _(unset)_ | Bearer token for **ingest** writes. Unset means ingest returns 404 — the endpoint does not admit it exists. |

Linkification rules live in `<VIBEDOCS_RUNS_DIR>/../agent-runs.json` (so
`~/.vibedocs/agent-runs.json` by default). This is what keeps every
tracker and repository URL out of the codebase:

```json
{
  "editorScheme": "editor://file",
  "linkify": [
    { "pattern": "\\b([A-Z]+-\\d+)\\b", "url": "https://tracker.example.com/browse/$1", "kind": "issue" },
    { "pattern": "\\bPR #(\\d+)\\b",    "url": "https://git.example.com/org/repo/pull/$1", "kind": "pr" }
  ]
}
```

Rules with an uncompilable pattern or an executable URL scheme are dropped at
load. A malformed file degrades to no rules rather than failing startup.

## Authorization

Two write paths with two threat models. **The browser is never given the ingest
token** — serving it to the page would put a shared secret in devtools.

| Path | Gate |
|---|---|
| `POST /api/runs`, `POST /api/runs/:id/events`, `POST …/commands/:cmdId/ack` | Bearer token (`VIBEDOCS_RUNS_TOKEN`) |
| `PATCH /api/runs/:id`, `POST /api/runs/:id/commands` | Same-origin `Origin` header (the CSRF boundary) |
| every `GET` | Open on loopback |

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/runs` | Register a run. Body: `{id?, title, description?, status?, links?, format, agent?, project?, workdir?}` → `{id, url}`. Re-registering an id updates metadata and keeps its events. |
| `POST` | `/api/runs/:id/events` | Append raw vendor lines: `{format, clientSeq?, events: [...]}`. Idempotent on `clientSeq`. |
| `PATCH` | `/api/runs/:id` | Partial update of `title`, `description`, `status`, `links`. |
| `GET` | `/api/runs` | Rail data. |
| `GET` | `/api/runs/:id` | Run metadata. |
| `GET` | `/api/runs/:id/events?fromRec=N` | Record page: `{records, recCount}`. |
| `GET` | `/api/runs/:id/events/:seq/output` | Highlighted HTML for one tool's output. Fetched lazily on expand. |
| `GET` | `/api/runs/config` | Linkify rules for the browser. |
| `POST` | `/api/runs/:id/commands` | Queue a command. `{kind: "stop"}` — the vocabulary is closed. |
| `GET` | `/api/runs/:id/commands?waitMs=` | Client long-polls for queued commands. |
| `POST` | `/api/runs/:id/commands/:cmdId/ack` | Client reports a command's outcome. |

**Statuses:** `running`, `idle`, `blocked`, `waiting`, `done`, `failed`,
`stopped`. The client owns the meaning; VibeDocs only renders them. `waiting` is
the "finished its turn but the work isn't landed" state.

**Links** are `{label, url, kind}` where `kind` (`issue` | `pr` | `ci` | `other`)
picks the icon. The client supplies the URLs; VibeDocs never builds one.

### What a client has to do

1. `POST /api/runs` on start, then stream `events.ndjson` lines to
   `POST /api/runs/:id/events` as they are written — batched, roughly every
   250ms or 64 lines.
2. `PATCH` the status on lifecycle transitions.
3. `PATCH` links when a PR appears.
4. Poll `GET /api/runs/:id/commands`, act on a queued `stop`, then ack it.

`scripts/replay-transcript.mjs` is a working reference for steps 1–2 and is
useful for pushing a captured transcript at a running server.

## Stopping a run

VibeDocs does not own the agent process and may not be on the same machine, so
it cannot kill anything. The Stop button records **intent**: it queues a command
that the owning client picks up on its next poll, acts on, and acks. The server
has no arbitrary-exec endpoint, and the command vocabulary is closed — `stop` is
the only value, and free text is rejected.

## Architecture

Three seams, each independently testable.

**Ingest** (`src/agent-runs/`) validates and persists writes. **Format adapters**
(`src/agent-runs/formats/`) normalize vendor JSON into one canonical event shape.
**View** (`frontend/src/agent-runs/`) renders canonical events and never parses
vendor JSON.

### Storage

Files on disk, no database:

```
<runsDir>/<runId>/meta.json       identity, status, links, counters
<runsDir>/<runId>/events.ndjson   append-only record log
<runsDir>/<runId>/commands.json   queued control commands
```

`events.ndjson` is a log of **records**, not events:

```ts
type EventRecord =
  | { op: 'append'; event: AgentEvent }
  | { op: 'patch'; seq: number; patch: Partial<AgentEvent> }
```

An append-only file cannot rewrite a tool call when it completes, and dropping
the `started` phase would make a running tool invisible while it runs. So
`started` appends an event with `status: 'running'` and `completed` patches it.
`applyRecords()` folds the log, and both server and browser use that one
function — which is why paging is by **record position** (`?fromRec=`) rather
than event seq: a patch can target an event from an earlier page.

Only canonical events are stored. `meta.json` records `adapterVersion`, so a
run always says which adapter shape produced it.

### Adding an adapter

Write `src/agent-runs/formats/<name>.ts` exporting a `FormatAdapter`, and add it
to the array in `formats/index.ts`. Nothing in ingest, the routes or the UI
changes. An adapter gets a batch of raw lines plus a per-run state object that
carries across batches, and returns records to append or patch.

Three rules the cursor adapter learned the hard way, worth checking against any
new vendor:

- **Do not assume a timestamp exists.** Several event types carry none; the
  adapter server-stamps from an injected clock.
- **Read the failure shape, not just the success shape.** Failed tool calls
  arrive under a separate discriminator carrying the same diagnostic fields.
  Treating failure as a malformed success loses exit codes and stderr on exactly
  the events an operator wants.
- **Project the payload down.** Vendors ship whole-file contents and command
  ASTs that nothing renders. Dropping them is what keeps stored runs a small
  fraction of raw size.
