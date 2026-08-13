#!/usr/bin/env node
/**
 * Supervise one agent run: register it, stream its transcript, and guarantee it
 * is closed out when the wrapped process dies.
 *
 * Usage:
 *   VIBEDOCS_RUNS_TOKEN=… node scripts/run-supervisor.mjs \
 *     --id <runId> [options] -- <command> [args...]
 *
 * Options:
 *   --id <runId>        required; names the run
 *   --title <text>      run title (default: the id)
 *   --project <name>    groups the run in the rail
 *   --workdir <path>    used to shorten displayed paths
 *   --transcript <path> NDJSON transcript to stream as it grows (optional)
 *   --format <name>     adapter for the transcript (default: cursor-stream-json)
 *   --url <base>        server base url (default: http://localhost:8080)
 *   --origin <origin>   only needed against a server whose control routes
 *                       predate accepting the ingest token
 *   --poll <ms>         transcript poll interval (default: 400)
 *   --batch <n>         transcript lines per POST (default: 64)
 *
 * Why this exists rather than asking the caller to report status: whoever starts
 * a run often is not around when it ends. An orchestrating agent's session
 * finishes, its context compacts, an operator interrupts it. Any of those and the
 * run is stranded in a non-terminal state forever. Tying the closeout to *this*
 * process's own death makes it structural instead of a promise.
 *
 * The honest limit: nothing here survives SIGKILL, the OOM killer, or power loss.
 * Those leave a stranded run for a reaper to find.
 */
import { spawn } from 'node:child_process'
import { mapExitToStatus, planSupervision } from './lib/supervisor-plan.mjs'
import { createRunsClient } from './lib/runs-client.mjs'
import { readFrom } from './lib/transcript-tail.mjs'

const plan = planSupervision(process.argv.slice(2), process.env)
if (!plan.ok) {
  console.error(`run-supervisor: ${plan.error}`)
  process.exit(2)
}
const cfg = plan.value
const client = createRunsClient({ url: cfg.url, token: cfg.token, origin: cfg.origin })

// ── register ────────────────────────────────────────────────────────────────
const created = await client.registerRun({
  id: cfg.id,
  title: cfg.title,
  format: cfg.format,
  status: 'running',
  ...(cfg.project ? { project: cfg.project } : {}),
  ...(cfg.workdir ? { workdir: cfg.workdir } : {}),
})
console.error(`run ${created.data.id} -> ${client.base}${created.data.url}`)

// ── stream the transcript, if there is one ──────────────────────────────────
let follower = null
if (cfg.transcript) {
  const pollMs = Number(argOf('--poll', '400'))
  const batchSize = Number(argOf('--batch', '64'))
  follower = followTranscript(cfg.transcript, { pollMs, batchSize })
}

// ── run the wrapped command ────────────────────────────────────────────────
let closed = false
let stopRequested = false
const child = spawn(cfg.command[0], cfg.command.slice(1), { stdio: 'inherit' })

/**
 * Close the run out exactly once.
 *
 * Idempotent because several paths lead here — the child exiting, a signal
 * arriving, an unexpected throw — and a second PATCH would overwrite the first
 * with a less accurate reason.
 */
async function closeout({ code, signal, description: override }) {
  if (closed) return
  closed = true
  // Await the final sweep: the last lines written are usually the most
  // interesting, and they must land before the terminal status so the UI does
  // not show a finished run missing its ending.
  if (follower) await follower.stop()

  const mapped = mapExitToStatus({ code, signal, stopRequested })
  const { status } = mapped
  const description = override ?? mapped.description
  try {
    await client.patchRun(cfg.id, { status, description })
    console.error(`run ${cfg.id} -> ${status}: ${description}`)
  } catch (err) {
    // Say so loudly: a failed closeout is exactly the stranded-run case this
    // script exists to prevent, and silence would hide it.
    console.error(`run-supervisor: FAILED to close out ${cfg.id}: ${err.message}`)
    process.exitCode = 1
  }
}

child.on('exit', async (code, signal) => {
  await closeout({ code, signal })
  process.exit(process.exitCode ?? (typeof code === 'number' ? code : 1))
})

// A command that cannot be spawned at all (typo, not on PATH) emits 'error' and
// never 'exit'. Without this the run would sit at `running` forever — precisely
// the stranded state this script exists to prevent, and the easiest one to hit.
child.on('error', async (err) => {
  await closeout({ code: null, signal: null, description: `Could not start the command: ${err.message}` })
  process.exit(1)
})

// A signal to the supervisor is passed to the child, then closeout runs on the
// child's exit. Forwarding rather than exiting immediately means we do not orphan
// a running agent to keep working with nothing watching it.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig)
  })
}

// ── helpers ────────────────────────────────────────────────────────────────

function argOf(flag, fallback) {
  const sep = process.argv.indexOf('--')
  const ours = sep === -1 ? process.argv : process.argv.slice(0, sep)
  const i = ours.indexOf(flag)
  return i >= 0 && ours[i + 1] !== undefined ? ours[i + 1] : fallback
}

/**
 * Poll a growing transcript and push new lines. Polling rather than fs.watch:
 * watch events are unreliable across editors and network filesystems, and a
 * stat() every 400ms is cheap.
 */
function followTranscript(filePath, { pollMs, batchSize }) {
  let offset = 0
  let clientSeq = 0
  let running = true
  let inFlight = false

  async function tick() {
    if (!running || inFlight) return
    inFlight = true
    try {
      const next = readFrom(filePath, offset)
      if (next.lines.length > 0) {
        offset = next.offset
        for (let i = 0; i < next.lines.length; i += batchSize) {
          await client.appendEvents(cfg.id, {
            format: cfg.format,
            clientSeq: ++clientSeq,
            events: next.lines.slice(i, i + batchSize),
          })
        }
      }
    } catch {
      // The file may not exist yet, or be briefly unavailable mid-rotation.
      // Neither is worth killing the run over; the next tick retries.
    } finally {
      inFlight = false
    }
  }

  const timer = setInterval(tick, pollMs)
  return {
    stop() {
      running = false
      clearInterval(timer)
      // One final sweep so events written just before the process died are not
      // lost — the most interesting lines are often the last ones.
      return tick()
    },
  }
}
