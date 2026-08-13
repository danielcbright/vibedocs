/**
 * Pure decisions the run supervisor makes. No IO, no processes — so the part
 * that is easy to get subtly wrong is also the part that is cheap to test.
 *
 * The supervisor's whole reason for existing is that a run must never be left in
 * a non-terminal state when whoever started it goes away. That means something
 * has to decide what a dead child process *meant*, and this module is that
 * decision.
 */

/**
 * Exit code → run status. Codes are a *client convention*, not a universal, so
 * this is a default rather than a law; a supervisor wrapping a different agent
 * passes its own map.
 *
 * The defaults follow the common headless-agent shape: 0 clean, 1 failure,
 * 2 blocked on a human (e.g. a locked credential store), 124 the conventional
 * timeout code used by `timeout(1)`.
 */
export const DEFAULT_EXIT_MAP = Object.freeze({
  0: 'waiting',
  1: 'failed',
  2: 'blocked',
  124: 'failed',
})

/** Anything not in the map is a failure — an unknown exit is not good news. */
const FALLBACK_STATUS = 'failed'

/**
 * Decide the terminal status and a human-readable reason for a finished run.
 *
 * `stopRequested` wins over the exit code, and that precedence is load-bearing:
 * stopping a run kills the child, which then exits non-zero, so without this the
 * status would be `failed` on every *successful* deliberate stop — the operator
 * would see a red run for doing exactly what the button offers.
 *
 * `done` is never returned. It has to stay a deliberate signal that the work
 * landed; a clean exit only means the turn finished, which is `waiting`
 * ("finished its turn, work not landed yet"). Auto-promoting that to `done`
 * would make every completed turn look shipped.
 */
export function mapExitToStatus({ code, signal = null, stopRequested = false }, exitMap = DEFAULT_EXIT_MAP) {
  if (stopRequested) {
    return { status: 'stopped', description: 'Stopped on request.' }
  }

  if (code === null || code === undefined) {
    return {
      status: 'failed',
      description: signal
        ? `Process terminated by ${signal}.`
        : 'Process terminated without an exit code.',
    }
  }

  const status = exitMap[code] ?? FALLBACK_STATUS
  return { status, description: describeExit(code, status) }
}

/** Statuses that mean the run is over. Mirrors the frontend's own set. */
export const TERMINAL_STATUSES = Object.freeze(['done', 'failed', 'stopped'])

/**
 * Which runs are stranded and should be closed out.
 *
 * The supervisor's closeout rests on signal handling, and nothing survives
 * SIGKILL, the OOM killer, or power loss. Those leave a run non-terminal with
 * nothing alive to finish it, and only an outside sweep can notice.
 *
 * Two restraints matter more than the detection itself:
 *
 * - **No supervisor record, no reaping.** A run with no local sidecar may be
 *   driven by a client on another machine. Local PID liveness says nothing about
 *   it, and guessing would mark someone else's healthy run as failed.
 * - **A PID is only meaningful on the host that issued it.** The same number is
 *   very likely a live, unrelated process here, so a sidecar from elsewhere is
 *   treated as unknown rather than as evidence.
 *
 * `isAlive` is injected so this stays pure and testable; the caller supplies a
 * real liveness probe.
 */
export function planReap(entries, isAlive, { host = null } = {}) {
  const plan = []
  for (const entry of entries ?? []) {
    if (TERMINAL_STATUSES.includes(entry.status)) continue

    const pid = entry.supervisorPid
    if (pid === null || pid === undefined) continue
    if (host !== null && entry.host !== undefined && entry.host !== host) continue

    if (!isAlive(pid)) {
      plan.push({
        id: entry.id,
        reason: `Supervisor (pid ${pid}) is gone; the run was never closed out.`,
      })
    }
  }
  return plan
}

/**
 * Which queued command, if any, this supervisor should act on.
 *
 * Only `stop` is understood. If the server's vocabulary ever grows, an older
 * supervisor must ignore what it cannot carry out rather than act-and-ack, which
 * would silently consume a command nobody honoured. An unacked command is the
 * only signal an operator has that nothing acted.
 */
export function selectStopCommand(commands) {
  if (!Array.isArray(commands)) return null
  const actionable = commands
    .filter((c) => c && c.kind === 'stop' && c.ackedAt === undefined)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  return actionable[0] ?? null
}

const DEFAULT_URL = 'http://localhost:8080'
const DEFAULT_FORMAT = 'cursor-stream-json'

/**
 * Parse argv into a supervision plan, or an error explaining what's missing.
 *
 * Everything before `--` is ours; everything after is the child's, verbatim.
 * That split is not cosmetic: the wrapped process is an agent CLI whose flags
 * collide with ours (`--format`, `--url`), so scanning the whole argv would read
 * the child's `--format text` as the run's adapter name and register the wrong
 * one. The failure would be silent — the run appears, the events don't parse.
 *
 * Returns a result object rather than throwing so the caller decides how to
 * report, and so this stays trivially testable.
 */
export function planSupervision(argv, env = {}) {
  const sep = argv.indexOf('--')
  const ours = sep === -1 ? argv : argv.slice(0, sep)
  const command = sep === -1 ? [] : argv.slice(sep + 1)

  const opt = (name, fallback) => {
    const i = ours.indexOf(`--${name}`)
    return i >= 0 && ours[i + 1] !== undefined ? ours[i + 1] : fallback
  }

  const fail = (error) => ({ ok: false, error })

  const id = opt('id', undefined)
  if (!id) return fail('--id <runId> is required: it names the run this supervises.')
  if (command.length === 0) {
    return fail('a command is required after `--`, e.g. `--id lane-a -- my-agent --flag`.')
  }

  const token = env.VIBEDOCS_RUNS_TOKEN
  if (!token) {
    return fail('VIBEDOCS_RUNS_TOKEN must be set — registering the run uses the ingest token.')
  }

  return {
    ok: true,
    value: {
      id,
      title: opt('title', id),
      url: opt('url', DEFAULT_URL).replace(/\/$/, ''),
      format: opt('format', DEFAULT_FORMAT),
      project: opt('project', undefined),
      workdir: opt('workdir', undefined),
      transcript: opt('transcript', undefined),
      // Escape hatch for a server predating the token-or-origin control gate.
      origin: opt('origin', undefined),
      token,
      command,
    },
  }
}

function describeExit(code, status) {
  if (code === 124) return 'Timed out before the turn finished.'
  if (code === 0) return 'Turn finished. Work not landed yet.'
  if (status === 'blocked') return `Blocked and needs a person (exit ${code}).`
  return `Failed with exit code ${code}.`
}
