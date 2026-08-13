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
 *   --capture <path>    write the child's stdout to this path and stream that,
 *                       for an agent that streams NDJSON rather than writing a
 *                       file (mutually exclusive with --transcript)
 *   --stop-command <cmd> run this instead of signalling the child on Stop, for a
 *                       client that owns the agent's process group
 *   --format <name>     adapter for the transcript (default: cursor-stream-json)
 *   --url <base>        server base url (default: http://localhost:8080)
 *   --origin <origin>   only needed against a server whose control routes
 *                       predate accepting the ingest token
 *   --poll <ms>         transcript poll interval (default: 400)
 *   --batch <n>         transcript lines per POST (default: 64)
 *   --stop-poll <ms>    how long each Stop long-poll parks (default: 25000)
 *   --kill-grace <ms>   wait after SIGTERM before SIGKILL, and the longest a
 *                       --stop-command may take (default: 10000)
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
import { createWriteStream, mkdirSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import {
  mapExitToStatus,
  planFollowResume,
  planStopAction,
  planSupervision,
  selectStopCommand,
} from './lib/supervisor-plan.mjs'
import { createRunsClient } from './lib/runs-client.mjs'
import { patchSidecar, readSidecar, resolveRunsDir } from './lib/run-sidecar.mjs'
import { createTranscriptFollower } from './lib/transcript-follower.mjs'
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

// ── work out where a previous turn on this run id left off ──────────────────
//
// Split by who actually knows. The server owns its own dedup counter, so the
// batch sequence is read back from it rather than guessed — that self-heals even
// with no local record. Byte offsets it knows nothing about, so those come from
// the sidecar. Read before the identity write below, which merges rather than
// overwrites, so both survive.
const runsDir = resolveRunsDir(process.env)
const priorFollow = readSidecar(runsDir, cfg.id)?.follow ?? null
const resumeSeq = await resolveResumeSeq(priorFollow)

// Leave a record of who is supervising this run, so a sweep can tell a stranded
// run from a healthy one after a hard kill this process could not trap. Written
// beside the run's own files, and best-effort: a supervisor on a different
// machine has no access to them, and that is exactly the case `reap` declines to
// judge.
patchSidecar(runsDir, cfg.id, { pid: process.pid, host: hostname(), startedAt: Date.now() })

// ── run the wrapped command ────────────────────────────────────────────────
let closed = false
let stopRequested = false
// `child.killed` is NOT liveness — Node sets it once a signal has been SENT,
// even if the process trapped it and kept running. Guarding an escalation on it
// makes SIGKILL unreachable, so a stubborn agent hangs the supervisor forever.
// Track the real exit instead.
let childExited = false
// With --capture, stdout is a pipe we tee into the transcript file; stdin and
// stderr stay inherited so prompts and diagnostics still reach the terminal.
const child = spawn(cfg.command[0], cfg.command.slice(1), {
  stdio: cfg.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
})
const captureDone = cfg.capture ? captureStdout(path.resolve(cfg.capture)) : null

// ── stream the transcript, if there is one ──────────────────────────────────
let follower = null
if (cfg.followPath) {
  const pollMs = Number(argOf('--poll', '400'))
  const batchSize = Number(argOf('--batch', '64'))
  follower = followTranscript(path.resolve(cfg.followPath), { pollMs, batchSize })
}

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
  // 'exit' fires when the process is gone, which is not when its piped stdout has
  // finished draining — so a capture has to be flushed before the sweep below
  // reads the file, or the run's last lines are still in a buffer. Bounded,
  // because an unbounded await here would strand the very run this script exists
  // to close out.
  if (captureDone) await Promise.race([captureDone, delay(FLUSH_TIMEOUT_MS)])
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

/** How long closeout waits for a capture's pipe to drain. */
const FLUSH_TIMEOUT_MS = 2000

/** A timer that never holds the process open on its own. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms).unref())
}

/**
 * Tee the child's stdout into the transcript file the follower reads.
 *
 * `--transcript` covers an agent that writes its own NDJSON file, but CLI agents
 * generally stream to stdout, which left the invocation needing a shell wrapper
 * (`-- bash -c "agent … > file"`) — and that wrapper is also what creates the
 * extra process layer that makes a direct kill hit the wrong pid. Doing the
 * redirect here removes the shell from the middle.
 *
 * Opened for append, not truncate: the file is the run's transcript across turns,
 * and appending is also what makes a resumed byte offset mean what it says.
 *
 * Resolves when the file is closed, so closeout can wait for the pipe to drain.
 */
function captureStdout(target) {
  if (!child.stdout) return null
  try {
    mkdirSync(path.dirname(target), { recursive: true })
  } catch {
    // createWriteStream will report the real problem below.
  }
  const sink = createWriteStream(target, { flags: 'a' })
  child.stdout.pipe(sink)
  return new Promise((resolve) => {
    sink.once('close', resolve)
    sink.once('error', (err) => {
      // Loud, then carry on: losing the transcript must not take the run's
      // lifecycle reporting down with it.
      console.error(`run-supervisor: capture to ${target} failed: ${err.message}`)
      resolve()
    })
  })
}

/**
 * The batch counter to continue from, asked of the server that does the deduping.
 *
 * `appendRecords` drops any batch whose `clientSeq <= lastClientSeq`, so a fresh
 * counter on a second turn makes the opening batches disappear and then, once it
 * passes the stored value, re-pushes the previous turn's lines as new events. The
 * server holds the only authoritative floor, and the sidecar is the fallback for
 * the case where that read fails — starting from 0 there would reintroduce the
 * silent-drop half of exactly the bug this prevents.
 */
async function resolveResumeSeq(priorFollow) {
  const recorded = Number.isFinite(priorFollow?.clientSeq) ? priorFollow.clientSeq : 0
  try {
    const { data: meta } = await client.getRun(cfg.id)
    return Math.max(recorded, Number.isFinite(meta?.lastClientSeq) ? meta.lastClientSeq : 0)
  } catch (err) {
    console.error(`run-supervisor: could not read ${cfg.id}'s batch counter (${err.message})`)
    return recorded
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
 * Four details carry the weight here:
 *
 * 1. **Set the flag before the stop happens.** Stopping the child makes it exit
 *    non-zero, which is indistinguishable from a crash by exit code alone — so
 *    without this, every successful deliberate stop would close the run as
 *    `failed` and the operator would see red for using the button as intended.
 * 2. **Ack only after acting.** An unacked command is the only signal that
 *    nobody honoured a stop; acking first would erase it.
 * 3. **Escalate.** An agent may trap SIGTERM and keep going, so a grace period
 *    later we SIGKILL. Stop has to actually stop.
 * 4. **Delegate when asked to.** `--stop-command` exists because signalling our
 *    own child is the wrong instrument for a client that owns the agent's
 *    process group; `planStopAction` holds that decision and what may be claimed
 *    after it. A delegated stop that fails is deliberately *not* followed by a
 *    signal, so the run never claims `stopped` over a live agent.
 */
function pollForStop() {
  const waitMs = Number(argOf('--stop-poll', '25000'))
  const graceMs = Number(argOf('--kill-grace', '10000'))
  const abort = new AbortController()
  let running = true
  // Commands whose delegated stop failed. They stay unacked on purpose — that is
  // the operator's evidence — which means the long-poll returns them instantly
  // forever, so they have to be skipped or this becomes a hot retry loop.
  const unhonoured = new Set()

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
        await delay(1000)
        continue
      }

      const pending = Array.isArray(commands) ? commands : []
      const cmd = selectStopCommand(pending.filter((c) => c && !unhonoured.has(c.id)))
      if (!cmd) {
        if (pending.length > 0) await delay(1000)
        continue
      }

      stopRequested = true // (1) before the stop, so the exit reads as `stopped`
      let action = planStopAction({ stopCommand: cfg.stopCommand })

      if (cfg.stopCommand) {
        // (4) The client's mechanism, run opaquely. Bounded by the same grace
        // window as a signal escalation: an unbounded wait here would park the
        // run at stop-pending with nothing left to move it.
        console.error(`run ${cfg.id}: stop requested — running the client's stop command`)
        action = planStopAction({
          stopCommand: cfg.stopCommand,
          delegateExit: await runStopCommand(cfg.stopCommand, graceMs),
        })
        // The window between the two assignments is unavoidable: the flag has to
        // be set before the stop, and whether the stop worked is only known after.
        stopRequested = action.stopHolds
      } else {
        console.error(`run ${cfg.id}: stop requested — terminating the agent`)
      }

      if (action.signalNow && !childExited) child.kill('SIGTERM')

      if (action.killAfterGrace) {
        const escalation = setTimeout(() => {
          if (!childExited) {
            console.error(
              action.mechanism === 'delegated'
                ? `run ${cfg.id}: the stop command reported success but the process is still alive after ${graceMs}ms — SIGKILL`
                : `run ${cfg.id}: agent ignored SIGTERM after ${graceMs}ms — SIGKILL`,
            )
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
      }

      if (!action.ack) {
        // (2) taken to its conclusion: nothing was stopped, so nothing is claimed.
        // The run keeps whatever outcome it really reaches, and the command stays
        // queued and unacked. Pressing Stop again queues a new one, which is
        // retried.
        console.error(`run ${cfg.id}: ${action.note} Leaving the stop unacked so it stays visible.`)
        unhonoured.add(cmd.id)
        continue
      }

      try {
        await client.ackCommand(cfg.id, cmd.id, action.note)
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
 * Run the client's stop command and report its exit code, or null if it could not
 * be run or outlived `timeoutMs`.
 *
 * Through a shell, because the string is opaque by design — the supervisor must
 * not learn how a client organises its own processes, and a client's stop is
 * often a pipeline or a shell function. Same trust level as the wrapped command
 * itself: both come from whoever invoked this script.
 */
function runStopCommand(command, timeoutMs) {
  let finished = false
  const settle = (resolve) => (value) => {
    finished = true
    resolve(value)
  }
  const exited = new Promise((resolve) => {
    const done = settle(resolve)
    const proc = spawn(command, { shell: true, stdio: 'inherit' })
    proc.once('error', (err) => {
      console.error(`run ${cfg.id}: could not run the stop command: ${err.message}`)
      done(null)
    })
    proc.once('exit', (code) => done(typeof code === 'number' ? code : null))
  })
  return Promise.race([
    exited,
    delay(timeoutMs).then(() => {
      // Promise.race does not cancel the loser, so this fires even when the
      // command finished in time. Announcing a timeout then would be a false log
      // line about the one thing an operator is reading these logs to establish.
      if (!finished) console.error(`run ${cfg.id}: the stop command did not finish within ${timeoutMs}ms`)
      return null
    }),
  ])
}

/**
 * Wire a follower to a real file and a real server, and poll it.
 *
 * Polling rather than fs.watch: watch events are unreliable across editors and
 * network filesystems, and a stat() every 400ms is cheap.
 *
 * Position survives the process, because a supervisor is one process per turn
 * while a run outlives several. See `planFollowResume` for what invalidates a
 * recorded offset, and why resuming the wrong one is silent rather than loud.
 */
function followTranscript(filePath, { pollMs, batchSize }) {
  const resume = planFollowResume(priorFollow, { path: filePath, ...describe(filePath) })
  if (priorFollow) {
    console.error(`run ${cfg.id}: transcript from byte ${resume.offset}, batch ${resumeSeq + 1} — ${resume.reason}`)
  }

  const follower = createTranscriptFollower({
    batchSize,
    offset: resume.offset,
    clientSeq: resumeSeq,
    read: (offset) => readFrom(filePath, offset),
    stat: () => describe(filePath),
    push: (events, clientSeq) => client.appendEvents(cfg.id, { format: cfg.format, clientSeq, events }),
    // `size` is recorded next to the offset so a later turn can tell a truncated
    // transcript from an appended one, and `path` so it can tell it is even
    // looking at the same file.
    persist: ({ offset, clientSeq, size, ino }) =>
      patchSidecar(runsDir, cfg.id, { follow: { path: filePath, offset, clientSeq, size: size ?? offset, ino } }),
    log: (message) => console.error(`run ${cfg.id}: ${message}`),
  })

  const timer = setInterval(follower.tick, pollMs)
  return {
    stop() {
      clearInterval(timer)
      return follower.flush()
    },
  }
}

/** Size and inode, or nulls when the file is not there — absence is not an error here. */
function describe(filePath) {
  try {
    const st = statSync(filePath)
    return { size: st.size, ino: st.ino }
  } catch {
    return { size: null, ino: null }
  }
}
