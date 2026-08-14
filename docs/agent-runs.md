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
| `VIBEDOCS_RUNS_TOKEN_FILE` | _(unset)_ | A file holding the token instead. Prefer this under a process manager: service config files are usually world-readable, so an embedded secret is readable by every local user. The direct variable wins if both are set; an unreadable file yields no token and ingest stays closed. |

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
| `PATCH /api/runs/:id`, `POST /api/runs/:id/commands` | Bearer token **or** same-origin `Origin` header |
| every `GET` | Open on loopback |

Control writes accept either credential because two legitimate callers need those
routes and neither can present the other's proof. The browser holds no secret, so
it proves same-origin — that check is the CSRF boundary, and it is why a
cross-origin page cannot drive Stop. A machine client reporting its own run
lifecycle has no origin to offer; requiring one would make it assert
browser-ness it does not have, hollowing out the signal the origin check exists
to read.

Allowing the ingest token to authorise a status write is a smaller increment
than it appears: a client that can append arbitrary events to a run's log can
already fabricate the whole transcript, and it is the authority on whether its
own turn succeeded. A missing `Origin` still fails the origin door — it simply no
longer ends the request, because the token door is open to exactly the
non-browser clients that absence identifies.

Failing both returns **403**, not ingest's 404. Ingest hides itself so the
feature cannot be fingerprinted; that buys nothing here, because reads are open
on loopback and already disclose both the route and the run. A disabled feature
still 404s everything, and that check runs first so a switched-off server never
reveals whether a token is configured.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/runs` | Register a run. Body: `{id?, title, description?, status?, links?, format, agent?, project?, workdir?}` → `{id, url}`. Re-registering an id updates metadata and keeps its events. |
| `POST` | `/api/runs/:id/events` | Append raw vendor lines: `{format, clientSeq?, events: [...]}`. Idempotent on `clientSeq`. |
| `PATCH` | `/api/runs/:id` | Partial update of `title`, `description`, `status`, `links`. `links` **replaces** the array — a client sending only a newly-found PR link drops the issue link it set earlier. |
| `DELETE` | `/api/runs/:id` | Remove a run and everything under it, and broadcast `run-deleted` so the rail drops it live. Gated like the other control writes; deletion is not more open than a status change. |
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
3. `PATCH` links when a PR appears. **`links` replaces the array** — send the full
   set every time, or a client reporting a newly-found PR silently drops the issue
   link it set earlier.
4. Poll `GET /api/runs/:id/commands`, act on a queued `stop`, then ack it.

`scripts/run-supervisor.mjs` does all four for an arbitrary agent command, and is
the reference to copy or to wrap:

```bash
VIBEDOCS_RUNS_TOKEN=… node scripts/run-supervisor.mjs \
  --id lane-a --project web-app --transcript /path/to/events.ndjson \
  -- my-agent --its-own --flags
```

`--transcript` follows a file the agent writes. For an agent that streams NDJSON
to **stdout**, which is what CLI agents generally do, use `--capture` instead and
the supervisor makes the file itself:

```bash
… --capture /path/to/events.ndjson -- my-agent --output-format stream-json
```

The two are mutually exclusive, since `--capture` writes the file the follower
reads. Prefer it over `-- bash -c "my-agent > file"`: that wrapper shell is also
the extra process layer that makes Stop signal the wrong pid (below). The file is
opened for **append**, so it stays the run's transcript across turns — which is
also what makes a resumed byte offset mean what it says.

### Why a supervisor rather than "the caller reports status"

Because the caller frequently is not alive when the run ends. An orchestrating
agent's session finishes, its context compacts, an operator interrupts it. Any of
those and the run sits at `running` forever. Tying the closeout to a process's own
death makes it structural rather than a promise, so the supervisor registers the
run, streams the transcript, and PATCHes a terminal status on **every** exit path —
including the one that is easiest to hit, a command that cannot be spawned at all
(which emits `error`, never `exit`).

Exit code → status, overridable because codes are a client convention:

| exit | status | why |
|---|---|---|
| 0 | `waiting` | the turn finished; the work has not landed |
| 1 | `failed` | |
| 2 | `blocked` | needs a person — distinct from failed so it is not buried |
| 124 | `failed` | timeout, named in the description |
| other | `failed` | an unknown exit is not good news |

**`done` is never set automatically.** It has to stay a deliberate signal that work
landed; promoting a clean exit to `done` would make every finished turn look
shipped.

### Stopping, end to end

`stop` records intent only — the server does not own the agent process and may not
be on the same machine, so it cannot kill anything. The full path:

1. The browser (or any control-authorised client) `POST`s `{"kind":"stop"}`.
2. The owning client's poller returns from `GET …/commands?waitMs=…`. This is a
   real long-poll backed by a waiter registry, not an interval — measured delivery
   is ~140ms after the request, so there is no reason to busy-poll.
3. It records that a stop was requested **before** killing anything. Skipping this
   is the classic mistake: the kill makes the agent exit non-zero, which by exit
   code alone is indistinguishable from a crash, so the run would close as `failed`
   on every *successful* deliberate stop.
4. It terminates the agent, escalating from `SIGTERM` to `SIGKILL` after a grace
   period — an agent may trap `SIGTERM` and carry on, and stop has to actually stop.
5. It acks **only after acting**. An unacked command is the only signal that nobody
   honoured a stop; acking first erases it.

If nothing is polling, a queued stop simply waits and `stopRequested` stays true.
That is why the rail renders a stop-pending state rather than continuing to show
the run as merely running.

#### When the supervisor holds the wrong pid

Step 4 assumes the process the supervisor spawned *is* the agent. A client that
spawns its agent into its own process group — common, since it lets the client
group-kill its own tree — leaves the supervisor holding only an intermediate
shell's pid. Measured: the agent was reparented to init, **kept running and kept
writing files**, while the run displayed `stopped`. A UI asserting something false
is worse than one that says nothing.

`--stop-command '<cmd>'` hands the kill back to the client. The supervisor runs
that string through a shell instead of signalling its child, and never learns what
the mechanism is — which is how client knowledge stays out of this repo:

```bash
… --stop-command 'kill -TERM -- -$(cat /run/lane-a.pgid)' -- my-dispatch-client
```

What it does with the result is the part worth knowing, because the two cases are
deliberately asymmetric:

| The stop command | Signals the child | Acks | Run reports |
|---|---|---|---|
| exited 0 | only if the child outlives `--kill-grace` | yes | `stopped` |
| exited non-zero, or outlived `--kill-grace` | never | **no** | whatever it really reaches |

A stop that succeeded asserts the agent is gone, so a child still alive after the
grace window is a leftover wrapper and killing it claims nothing false. A stop
that *failed* asserts nothing: killing the wrapper then would close the run as
`stopped` over a live agent, which is the exact lie the flag exists to remove. So
nothing is killed, the command is left unacked — an unacked command is the only
evidence an operator has that nothing honoured a stop — and pressing Stop again
queues a new command, which is retried. The failed one is not retried in a loop,
because a pending command returns from the long-poll instantly and forever.

### More than one turn on one run

A supervisor is one process per invocation; a run outlives several. Both halves of
"where was I" therefore have to be recovered on startup, and they come from
different places because different parties know them:

- **The batch counter** is read back from the server (`GET /api/runs/:id`), which
  owns it. Ingest dedups on `clientSeq <= lastClientSeq`, so a second turn
  starting its counter at 1 has its opening batches silently dropped, and then —
  once the counter passes the stored value — re-pushes the *earlier* turn's lines
  as new events. Missing start, duplicated middle, no error anywhere. Asking the
  server self-heals even with no local record.
- **The byte offset** comes from `<runsDir>/<id>/supervisor.json`, because the
  server knows nothing about the client's file. Four things invalidate a recorded
  offset and reset it to 0: the file is gone, the path changed, the inode changed
  (a client that *recreates* its transcript, which a size comparison cannot catch
  once the new file is longer), or it shrank (one that truncates in place). A
  shrink is also checked on every pass, not just at startup, since a client can
  rewrite its transcript while this is still following.

The sidecar therefore has two writers — the supervisor's identity, written once,
and the follow position, written continuously — so both go through
`patchSidecar`, which merges. A plain write of either erases the other.

The one case nothing can distinguish: a truncate-in-place that regrows past the
old offset before anyone looks. It reads exactly like an append.

### The limits, stated plainly

- **No signal handler survives `SIGKILL`, the OOM killer, or power loss.** Those
  leave a run non-terminal with nothing alive to close it. `scripts/reap-runs.mjs`
  sweeps for them: it closes any non-terminal run whose recorded supervisor is
  gone, and `--dry-run` reports without mutating.
- **Reaping is deliberately narrow.** It only judges runs it has a local
  supervisor record for, on this host. A run driven from another machine is left
  alone — a local pid says nothing about it, and a wrong guess would mark a healthy
  run failed.
- **A delegated stop is only as truthful as the client's own stop command.** If it
  exits 0 without actually stopping anything, the run reports `stopped` over a live
  agent. The supervisor cannot check the claim; it can only decline to make one of
  its own when the command reports failure.
- **Out-of-band edits do not broadcast.** Hand-editing a run's files (or deleting
  its directory rather than using `DELETE`) is invisible to connected clients until
  they reload. Fine for a break-glass fix; worth knowing before you conclude the UI
  is stale for some other reason.

`scripts/replay-transcript.mjs` is a working reference for steps 1–2 and is
useful for pushing a captured transcript at a running server:

```bash
export VIBEDOCS_RUNS_TOKEN=...

# backfill a finished transcript
node scripts/replay-transcript.mjs <events.ndjson> --id my-run --project my-app

# attach to a session that is still being written, and keep following it
node scripts/replay-transcript.mjs <events.ndjson> --id my-run --follow
```

`--follow` reads from a byte offset and leaves a partial trailing line for the
next pass, so a line the agent is mid-way through writing is never parsed as
truncated JSON.

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
