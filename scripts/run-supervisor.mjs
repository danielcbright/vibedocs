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
 *   --stop-poll <ms>    how long each Stop long-poll parks (default: 25000)
 *   --kill-grace <ms>   wait after SIGTERM before SIGKILL (default: 10000)
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
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import { mapExitToStatus, planSupervision, selectStopCommand } from './lib/supervisor-plan.mjs'
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

// Leave a record of who is supervising this run, so a sweep can tell a stranded
// run from a healthy one after a hard kill this process could not trap. Written
// beside the run's own files, and best-effort: a supervisor on a different
// machine has no access to them, and that is exactly the case `reap` declines to
// judge.
writeSupervisorSidecar(cfg.id)

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
// `child.killed` is NOT liveness — Node sets it once a signal has been SENT,
// even if the process trapped it and kept running. Guarding an escalation on it
// makes SIGKILL unreachable, so a stubborn agent hangs the supervisor forever.
// Track the real exit instead.
let childExited = false
const child = spawn(cfg.command[0], cfg.command.slice(1), { stdio: 'inherit' })

// ── honour the Stop button ─────────────────────────────────────────────────
// The server cannot kill anything — it may not even be on this host — so Stop
// only records intent. Something on this machine has to collect it, and this
// supervisor is the natural owner: it already lives exactly as long as the run
// and it already holds the child's PID, which makes its kill precisely scoped
// with no process-name matching.
const stopPoller = pollForStop()

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
  stopPoller.stop()
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
  childExited = true
  await closeout({ code, signal })
  process.exit(process.exitCode ?? (typeof code === 'number' ? code : 1))
})

// A command that cannot be spawned at all (typo, not on PATH) emits 'error' and
// never 'exit'. Without this the run would sit at `running` forever — precisely
// the stranded state this script exists to prevent, and the easiest one to hit.
child.on('error', async (err) => {
  childExited = true
  await closeout({ code: null, signal: null, description: `Could not start the command: ${err.message}` })
  process.exit(1)
})

// A signal to the supervisor is passed to the child, then closeout runs on the
// child's exit. Forwarding rather than exiting immediately means we do not orphan
// a running agent to keep working with nothing watching it.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (!childExited) child.kill(sig)
  })
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Record this supervisor's identity next to the run.
 *
 * The host is recorded alongside the pid because a pid alone is meaningless
 * elsewhere — the same number is very likely a live, unrelated process on another
 * machine, so a reaper that ignored the host could mark a healthy run failed.
 */
function writeSupervisorSidecar(runId) {
  try {
    const runsDir = process.env.VIBEDOCS_RUNS_DIR
      ? path.resolve(process.env.VIBEDOCS_RUNS_DIR)
      : path.join(homedir(), '.vibedocs', 'runs')
    const file = path.join(runsDir, runId, 'supervisor.json')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({ pid: process.pid, host: hostname(), startedAt: Date.now() }, null, 2) + '\n',
    )
  } catch {
    // Not fatal. Losing the sidecar only means a hard-killed run cannot be
    // auto-reaped; the run itself is unaffected.
  }
}

function argOf(flag, fallback) {
  const sep = process.argv.indexOf('--')
  const ours = sep === -1 ? process.argv : process.argv.slice(0, sep)
  const i = ours.indexOf(flag)
  return i >= 0 && ours[i + 1] !== undefined ? ours[i + 1] : fallback
}

/**
 * Long-poll the command queue and act on a queued stop.
 *
 * Three details carry the weight here:
 *
 * 1. **Set the flag before killing.** Stopping the child makes it exit non-zero,
 *    which is indistinguishable from a crash by exit code alone — so without
 *    this, every successful deliberate stop would close the run as `failed` and
 *    the operator would see red for using the button as intended.
 * 2. **Ack only after acting.** An unacked command is the only signal that
 *    nobody honoured a stop; acking first would erase it.
 * 3. **Escalate.** An agent may trap SIGTERM and keep going, so a grace period
 *    later we SIGKILL. Stop has to actually stop.
 */
function pollForStop() {
  const waitMs = Number(argOf('--stop-poll', '25000'))
  const graceMs = Number(argOf('--kill-grace', '10000'))
  const abort = new AbortController()
  let running = true

  ;(async () => {
    while (running && !closed) {
      let commands
      try {
        const res = await client.listCommands(cfg.id, waitMs, abort.signal)
        commands = res.data
      } catch (err) {
        if (abort.signal.aborted) return
        // A transient failure must not silently end stop support for the rest of
        // the run, so pause briefly and re-park rather than giving up.
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }

      const cmd = selectStopCommand(commands)
      if (!cmd) continue

      stopRequested = true // (1) before the kill, so the exit reads as `stopped`
      console.error(`run ${cfg.id}: stop requested — terminating the agent`)
      if (!childExited) child.kill('SIGTERM')

      const escalation = setTimeout(() => {
        if (!childExited) {
          console.error(`run ${cfg.id}: agent ignored SIGTERM after ${graceMs}ms — SIGKILL`)
          try {
            child.kill('SIGKILL')
          } catch {
            // Already gone between the check and the signal; nothing to do.
          }
        }
      }, graceMs)

      // Clear the escalation once the child is genuinely gone, so a stopped run
      // does not hold the process open for the rest of the grace window.
      child.once('exit', () => clearTimeout(escalation))

      try {
        await client.ackCommand(cfg.id, cmd.id, 'Stopped by the run supervisor.') // (2)
      } catch (err) {
        console.error(`run ${cfg.id}: acted on the stop but could not ack it: ${err.message}`)
      }
      return
    }
  })()

  return {
    stop() {
      running = false
      abort.abort()
    },
  }
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
