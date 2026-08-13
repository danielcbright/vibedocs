#!/usr/bin/env node
/**
 * Close out runs whose supervisor died without closing them.
 *
 * Usage:
 *   VIBEDOCS_RUNS_TOKEN=… node scripts/reap-runs.mjs [--url <base>] [--dry-run]
 *
 * The supervisor guarantees closeout by trapping signals, and no trap survives
 * SIGKILL, the OOM killer, or power loss. Those leave a run non-terminal with
 * nothing alive to finish it — a small hole, but one that only an outside sweep
 * can notice. Run this on login, on a timer, or by hand when the rail shows a
 * run that has obviously stopped moving.
 *
 * Deliberately conservative: it only judges runs it has a local supervisor
 * record for, on this host. A run driven from another machine is left alone,
 * because a local pid says nothing about it and a wrong guess would mark a
 * healthy run failed.
 */
import { readFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import { planReap } from './lib/supervisor-plan.mjs'
import { createRunsClient } from './lib/runs-client.mjs'

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const dryRun = argv.includes('--dry-run')

const token = process.env.VIBEDOCS_RUNS_TOKEN
const url = opt('url', 'http://localhost:8080')
const origin = opt('origin', url)
const runsDir = process.env.VIBEDOCS_RUNS_DIR
  ? path.resolve(process.env.VIBEDOCS_RUNS_DIR)
  : path.join(homedir(), '.vibedocs', 'runs')

const client = createRunsClient({ url, token, origin })

/** Real liveness probe: signal 0 tests existence without delivering anything. */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means it exists but belongs to another user — alive for our purposes.
    return err.code === 'EPERM'
  }
}

function readSidecar(runId) {
  try {
    const raw = readFileSync(path.join(runsDir, runId, 'supervisor.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return { supervisorPid: parsed.pid ?? null, host: parsed.host }
  } catch {
    return { supervisorPid: null }
  }
}

const { data: runs } = await client.listRuns()
const entries = runs.map((r) => ({ id: r.id, status: r.status, ...readSidecar(r.id) }))
const plan = planReap(entries, isAlive, { host: hostname() })

if (plan.length === 0) {
  console.log(`reap: nothing stranded (${runs.length} run${runs.length === 1 ? '' : 's'} checked)`)
  process.exit(0)
}

for (const { id, reason } of plan) {
  if (dryRun) {
    console.log(`reap: WOULD close ${id} — ${reason}`)
    continue
  }
  try {
    await client.patchRun(id, { status: 'failed', description: reason })
    console.log(`reap: closed ${id} as failed — ${reason}`)
  } catch (err) {
    console.error(`reap: could not close ${id}: ${err.message}`)
    process.exitCode = 1
  }
}
