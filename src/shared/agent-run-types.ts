/**
 * Canonical Agent Runs wire types — shared between the Hono backend (src/) and
 * the React frontend (frontend/src/, via the `@shared/*` alias).
 *
 * Vendor-neutral by construction: nothing here knows about any particular agent
 * or issue tracker. Format adapters (src/agent-runs/formats/) map vendor JSON
 * into these shapes; the frontend only ever sees these shapes.
 */

export type RunStatus =
  | 'running'   // agent is working
  | 'idle'      // alive, nothing in flight
  | 'blocked'   // needs a human
  | 'waiting'   // finished its turn, work not landed yet
  | 'done'
  | 'failed'
  | 'stopped'

export const RUN_STATUSES: readonly RunStatus[] = [
  'running', 'idle', 'blocked', 'waiting', 'done', 'failed', 'stopped',
]

/** Display hint that selects the icon. VibeDocs never builds the URL. */
export type LinkKind = 'issue' | 'pr' | 'ci' | 'other'

export interface RunLink {
  label: string
  url: string
  kind: LinkKind
}

export type EventKind =
  | 'init' | 'user' | 'thinking' | 'assistant' | 'tool' | 'result' | 'other'

export type ToolStatus = 'running' | 'success' | 'error'

export interface ToolInfo {
  /** Vendor-neutral tool name: 'shell' | 'read' | 'edit' | 'grep' | 'glob' | … */
  name: string
  callId: string
  /** One-line display form: the command, or a path relative to the run's workdir. */
  label: string
  /** Projected args — display-relevant fields only. See the adapter. */
  args: Record<string, unknown>
  status: ToolStatus
  exitCode?: number
  output?: string
  /** True when `output` was cut at MAX_TOOL_OUTPUT_BYTES. */
  outputTruncated?: boolean
  linesAdded?: number
  linesRemoved?: number
  endTs?: number
}

export interface AgentEvent {
  /** Server-assigned, monotonic per run, 1-based. */
  seq: number
  /** Epoch ms. Server-stamped when the client omits it — never assume the vendor sent one. */
  ts: number
  kind: EventKind
  /** user/assistant/thinking/result body. Markdown for assistant + result. */
  text?: string
  tool?: ToolInfo
  /** Kind-specific: durationMs, tokens, sessionId, model, isError. */
  meta?: Record<string, unknown>
}

/**
 * A line of events.ndjson.
 *
 * The file is append-only, so a tool call that starts and later completes
 * cannot be rewritten in place. `started` appends an event with
 * tool.status === 'running' (so a live viewer sees it immediately) and
 * `completed` emits a patch against that seq. `applyRecords` folds the log
 * into the logical event list.
 */
export type EventRecord =
  | { op: 'append'; event: AgentEvent }
  | { op: 'patch'; seq: number; patch: Partial<AgentEvent> }

/** Per-event cap on stored tool output. Beyond this, truncate and flag. */
export const MAX_TOOL_OUTPUT_BYTES = 256 * 1024

/** Bump when adapter output changes shape. Recorded in meta.json. */
export const ADAPTER_VERSION = 1

/**
 * Fold an ordered run of records onto a prior event list.
 */
export function applyRecords(
  events: readonly AgentEvent[],
  records: readonly EventRecord[],
): AgentEvent[] {
  const bySeq = new Map<number, AgentEvent>()
  const order: number[] = []
  for (const e of events) {
    bySeq.set(e.seq, e)
    order.push(e.seq)
  }

  for (const rec of records) {
    if (rec.op === 'append') {
      if (!bySeq.has(rec.event.seq)) order.push(rec.event.seq)
      bySeq.set(rec.event.seq, rec.event)
      continue
    }
    const existing = bySeq.get(rec.seq)
    if (!existing) continue
    const { tool: toolPatch, meta: metaPatch, ...rest } = rec.patch
    bySeq.set(rec.seq, {
      ...existing,
      ...rest,
      // tool and meta merge field-wise: the patch carries only what changed
      // (status/exitCode/output), and must not drop name/callId/label/args.
      ...(toolPatch ? { tool: { ...(existing.tool ?? {}), ...toolPatch } as ToolInfo } : {}),
      ...(metaPatch ? { meta: { ...(existing.meta ?? {}), ...metaPatch } } : {}),
    })
  }

  return order.map((seq) => bySeq.get(seq)!).sort((a, b) => a.seq - b.seq)
}
