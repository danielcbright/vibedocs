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
 *   --follow          keep tailing the file and push new lines as they arrive
 *                     (Ctrl-C to stop). Use this to watch a live agent session.
 *   --poll <ms>       how often to check for growth in --follow (default: 400)
 */
import path from 'node:path'
import { readFrom } from './lib/transcript-tail.mjs'

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
const follow = args.includes('--follow')
const pollMs = parseInt(opt('poll', '400'), 10)

// readFrom lives in ./lib/transcript-tail.mjs — shared with run-supervisor.mjs so
// the offset arithmetic and the partial-trailing-line rule exist in one place.

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
let pushed = 0

async function push(lines) {
  for (let i = 0; i < lines.length; i += batchSize) {
    const { data } = await post(`/api/runs/${encodeURIComponent(id)}/events`, {
      format, clientSeq: ++clientSeq, events: lines.slice(i, i + batchSize),
    })
    pushed += Math.min(batchSize, lines.length - i)
    process.stdout.write(`\r${pushed} lines pushed — ${data.eventCount} events`)
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
  }
}

let offset = 0
{
  const first = readFrom(file, offset)
  offset = first.offset
  await push(first.lines)
}

if (!follow) {
  console.log(`\ndone — ${base}${created.data.url}`)
  process.exit(0)
}

console.log(`\nfollowing ${file} — Ctrl-C to stop`)
process.on('SIGINT', () => {
  console.log('\nstopped following')
  process.exit(0)
})

// Poll rather than fs.watch: watch events are unreliable across editors and
// network filesystems, and a 400ms poll on a stat() is cheap.
for (;;) {
  await new Promise((r) => setTimeout(r, pollMs))
  let next
  try {
    next = readFrom(file, offset)
  } catch {
    continue // file briefly unavailable (rotated, being replaced) — try again
  }
  if (next.lines.length === 0) continue
  offset = next.offset
  await push(next.lines)
}
