/**
 * The supervisor's own notes about a run, kept beside the run's files.
 *
 * Two unrelated things live in `supervisor.json`, which is what makes a shared
 * module worth having rather than two `writeFileSync` calls:
 *
 * - **Who is supervising** (`pid`, `host`, `startedAt`), written once at start so
 *   a sweep can tell a stranded run from a healthy one after a hard kill no trap
 *   could catch. `scripts/reap-runs.mjs` reads exactly this.
 * - **Where the follower got to** (`follow`), written continuously so a second
 *   turn on the same run id resumes instead of restarting at byte 0.
 *
 * Nothing here throws. Losing the sidecar degrades two conveniences — a
 * hard-killed run cannot be auto-reaped, and a resumed follower starts over —
 * and neither is worth failing a run over.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * Where runs live. Resolved from the env the same way the server does it, so a
 * supervisor and the server it talks to look in the same place.
 */
export function resolveRunsDir(env = process.env) {
  return env.VIBEDOCS_RUNS_DIR
    ? path.resolve(env.VIBEDOCS_RUNS_DIR)
    : path.join(homedir(), '.vibedocs', 'runs')
}

export function sidecarPath(runsDir, runId) {
  return path.join(runsDir, runId, 'supervisor.json')
}

/** The sidecar's contents, or null if there is no readable one. */
export function readSidecar(runsDir, runId) {
  try {
    const parsed = JSON.parse(readFileSync(sidecarPath(runsDir, runId), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Merge fields into the sidecar, preserving whatever else is in it.
 *
 * Read-modify-write, not overwrite, and that is load-bearing now that two
 * writers share the file. A plain write of the identity fields at startup would
 * erase the follow position, which is bug-shaped rather than merely lossy: the
 * follower would restart at byte 0 and re-push the whole transcript.
 *
 * Returns whether the write landed, for callers that want to say so.
 */
export function patchSidecar(runsDir, runId, patch) {
  try {
    const file = sidecarPath(runsDir, runId)
    mkdirSync(path.dirname(file), { recursive: true })
    const merged = { ...(readSidecar(runsDir, runId) ?? {}), ...patch }
    writeFileSync(file, JSON.stringify(merged, null, 2) + '\n')
    return true
  } catch {
    return false
  }
}
