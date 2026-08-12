#!/usr/bin/env node
/**
 * Replay a captured agent transcript into a running vibedocs server.
 *
 * Usage:
 *   VIBEDOCS_RUNS_TOKEN=… node scripts/replay-transcript.mjs <events.ndjson> [options]
 *
 * Options:
 *   --id <runId>      run id to create (default: the file's parent dir name)
 *   --title <text>    run title (default: the run id)
 *   --format <name>   adapter name (default: cursor-stream-json)
 *   --url <base>      server base url (default: http://localhost:8080)
 *   --batch <n>       lines per POST (default: 64)
 *   --delay <ms>      pause between batches, to watch it stream (default: 0)
 *   --workdir <path>  run workdir, used to shorten displayed paths
 *   --project <name>  project this run belongs to, used to group the rail
 *   --status <s>      initial status (default: running)
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
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
const project = opt('project', undefined)
const status = opt('status', 'running')

const lines = readFileSync(file, 'utf8')
  .split('\n').filter((l) => l.trim().length > 0)
  .map((l) => { try { return JSON.parse(l) } catch { return null } })
  .filter(Boolean)

async function post(pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // The SPA fallback answers unmatched paths with 200 text/html, so res.ok
  // alone would report a missing route as success. Demand JSON.
  const ct = res.headers.get('content-type') ?? ''
  if (!res.ok || !ct.includes('application/json')) {
    console.error(`\n${pathname} -> ${res.status} ${ct}\n${(await res.text()).slice(0, 300)}`)
    process.exit(1)
  }
  return res.json()
}

const created = await post('/api/runs', {
  id, title, format, status,
  ...(workdir ? { workdir } : {}),
  ...(project ? { project } : {}),
})
console.log(`run ${created.data.id} -> ${base}${created.data.url}`)

let clientSeq = 0
for (let i = 0; i < lines.length; i += batchSize) {
  const { data } = await post(`/api/runs/${encodeURIComponent(id)}/events`, {
    format, clientSeq: ++clientSeq, events: lines.slice(i, i + batchSize),
  })
  process.stdout.write(`\r${Math.min(i + batchSize, lines.length)}/${lines.length} lines — ${data.eventCount} events`)
  if (delay > 0) await new Promise((r) => setTimeout(r, delay))
}
console.log(`\ndone — ${base}${created.data.url}`)
