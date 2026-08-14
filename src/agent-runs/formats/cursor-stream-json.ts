/**
 * cursor-agent `--output-format stream-json` adapter.
 *
 * Every rule here was measured against real captured transcripts; see the
 * "Data facts" table in the implementation plan.
 *
 * This module is pure apart from the injected clock.
 */

import {
  MAX_TOOL_OUTPUT_BYTES,
  type AgentEvent,
  type ToolInfo,
  type ToolStatus,
} from '../../shared/agent-run-types.js'
import type { AdapterState, FormatAdapter, NormalizeCtx, PendingRecord } from './types.js'

interface CursorState extends AdapterState {
  /** Accumulating thinking deltas, flushed on a terminator or a foreign event. */
  thinkingParts: string[]
  thinkingStartTs: number | null
  /** callIds we have already appended a `running` event for. */
  openCalls: Set<string>
}

function createState(): CursorState {
  return { thinkingParts: [], thinkingStartTs: null, openCalls: new Set() }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Concatenate the text parts of a vendor `message.content` array. */
function messageText(e: Record<string, unknown>): string {
  const msg = e.message
  if (!isRecord(msg) || !Array.isArray(msg.content)) return ''
  return msg.content
    .map((part) => (isRecord(part) ? (str(part.text) ?? '') : ''))
    .join('')
}

/**
 * Resolve an event's timestamp.
 *
 * Never assume the vendor sent one: system/init, user, result and some
 * assistant events routinely carry no `timestamp_ms` at all. A tool body's
 * `startedAtMs` (a string) is the next-best source before the server clock.
 */
function resolveTs(
  e: Record<string, unknown>,
  toolBody: Record<string, unknown> | null,
  now: () => number,
): number {
  return num(e.timestamp_ms) ?? (toolBody ? num(toolBody.startedAtMs) : undefined) ?? now()
}

/**
 * `call_id` is two ids joined by a newline, and only the first segment is
 * stable across the started/completed pair — so it is the identity we key on.
 * Miss this and no tool call ever pairs.
 */
function normalizeCallId(raw: unknown): string | undefined {
  const s = str(raw)
  if (!s) return undefined
  const first = s.split('\n')[0].trim()
  return first.length > 0 ? first : undefined
}

/**
 * Keep only display-relevant args. `parsingResult` (a full shell AST) and the
 * toolCallId echoes are the bulk of the raw payload and nothing renders them.
 */
const ARG_ALLOWLIST: Record<string, readonly string[]> = {
  shell: ['command', 'workingDirectory'],
  read: ['path', 'offset', 'limit'],
  edit: ['path'],
  write: ['path'],
  grep: ['pattern', 'path', 'outputMode', 'caseInsensitive', 'multiline'],
  glob: ['pattern', 'path'],
  ls: ['path'],
}

function projectArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const allow = ARG_ALLOWLIST[toolName]
  const out: Record<string, unknown> = {}
  if (allow) {
    for (const k of allow) if (args[k] !== undefined && args[k] !== '') out[k] = args[k]
    return out
  }
  // Unknown tool: scalars only, so a future tool degrades gracefully instead of
  // dragging an arbitrary object graph into storage.
  for (const [k, v] of Object.entries(args)) {
    const t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') out[k] = v
  }
  return out
}

/** Short, scannable one-line description of a tool call. */
function toolLabel(args: Record<string, unknown>): string {
  for (const k of ['command', 'pattern', 'query', 'url']) {
    const v = str(args[k])
    if (v) return v
  }
  for (const k of ['path', 'file_path']) {
    const v = str(args[k])
    if (v) return v
  }
  return JSON.stringify(args).slice(0, 200)
}

/** `shellToolCall` -> `shell`. */
function toolNameFromKey(key: string): string {
  return key.endsWith('ToolCall') ? key.slice(0, -'ToolCall'.length) : key
}

interface ToolResultProjection {
  status: ToolStatus
  exitCode?: number
  output?: string
  outputTruncated?: boolean
  linesAdded?: number
  linesRemoved?: number
}

function capOutput(text: string): { output: string; truncated: boolean } {
  if (text.length <= MAX_TOOL_OUTPUT_BYTES) return { output: text, truncated: false }
  return { output: text.slice(0, MAX_TOOL_OUTPUT_BYTES) + '\n… truncated …', truncated: true }
}

/**
 * Project a tool result down to what the timeline renders.
 *
 * `result` is `{ success }` XOR `{ failure }` — a genuinely separate
 * discriminator, not a malformed success. Both bodies carry the same
 * diagnostic fields, so they project identically; only the status differs.
 * Getting this wrong loses stdout/stderr/exitCode on exactly the events an
 * operator most wants to read.
 *
 * `beforeFullFileContent` / `afterFullFileContent` are deliberately never kept:
 * they are the entire file, twice, per edit, and they are most of the raw
 * payload's size.
 */
function projectResult(result: unknown): ToolResultProjection | null {
  if (!isRecord(result)) return null

  const failure = isRecord(result.failure) ? result.failure : null
  const success = isRecord(result.success) ? result.success : null
  const body = failure ?? success
  if (!body) {
    // A result object in neither shape: record it without inventing detail.
    return { status: 'error', output: JSON.stringify(result).slice(0, 2000) }
  }

  const exitCode = num(body.exitCode)
  // A nonzero exit inside a `success` envelope is still a failed command.
  let status: ToolStatus = failure ? 'error' : 'success'
  if (status === 'success' && exitCode !== undefined && exitCode !== 0) status = 'error'

  const stdout = str(body.stdout) ?? ''
  const stderr = str(body.stderr) ?? ''
  const combined =
    [stdout, stderr].filter((s) => s.length > 0).join('\n') ||
    str(body.diffString) ||
    str(body.content) ||
    str(body.message) ||
    ''

  const { output, truncated } = capOutput(combined)
  const projection: ToolResultProjection = { status }
  if (exitCode !== undefined) projection.exitCode = exitCode
  if (output.length > 0) projection.output = output
  if (truncated) projection.outputTruncated = true
  const added = num(body.linesAdded)
  const removed = num(body.linesRemoved)
  if (added !== undefined) projection.linesAdded = added
  if (removed !== undefined) projection.linesRemoved = removed
  return projection
}

function normalize(raw: unknown[], stateIn: AdapterState, ctx: NormalizeCtx): PendingRecord[] {
  const state = stateIn as CursorState
  const out: PendingRecord[] = []
  const append = (event: Omit<AgentEvent, 'seq'>) => out.push({ op: 'append', event })

  const flushThinking = () => {
    if (state.thinkingParts.length === 0) return
    append({
      kind: 'thinking',
      ts: state.thinkingStartTs ?? ctx.now(),
      text: state.thinkingParts.join(''),
    })
    state.thinkingParts = []
    state.thinkingStartTs = null
  }

  for (const line of raw) {
    if (!isRecord(line)) continue
    const type = str(line.type)
    if (!type) continue
    const subtype = str(line.subtype)

    // Thinking is the only buffered kind; every other kind flushes it first so
    // the reasoning node lands before whatever interrupted it.
    if (type === 'thinking') {
      if (subtype === 'delta') {
        if (state.thinkingStartTs === null) state.thinkingStartTs = resolveTs(line, null, ctx.now)
        state.thinkingParts.push(str(line.text) ?? '')
      } else {
        flushThinking()
      }
      continue
    }

    flushThinking()

    switch (type) {
      case 'system': {
        if (subtype !== 'init') break
        append({
          kind: 'init',
          ts: resolveTs(line, null, ctx.now),
          meta: {
            sessionId: str(line.session_id),
            model: str(line.model),
            cwd: str(line.cwd),
            permissionMode: str(line.permissionMode),
          },
        })
        break
      }

      case 'user': {
        append({ kind: 'user', ts: resolveTs(line, null, ctx.now), text: messageText(line) })
        break
      }

      case 'assistant': {
        const text = messageText(line)
        // Cursor emits assistant frames with no text alongside tool calls; a
        // node with nothing in it is noise on the timeline.
        if (text.length === 0) break
        append({ kind: 'assistant', ts: resolveTs(line, null, ctx.now), text })
        break
      }

      case 'result': {
        const usage = isRecord(line.usage) ? line.usage : {}
        append({
          kind: 'result',
          ts: resolveTs(line, null, ctx.now),
          text: str(line.result) ?? '',
          meta: {
            isError: line.is_error === true,
            resultSubtype: subtype,
            durationMs: num(line.duration_ms),
            inputTokens: num(usage.inputTokens),
            outputTokens: num(usage.outputTokens),
            sessionId: str(line.session_id),
          },
        })
        break
      }

      case 'tool_call': {
        const container = isRecord(line.tool_call) ? line.tool_call : null
        if (!container) break
        const key = Object.keys(container).find((k) => k.endsWith('ToolCall'))
        if (!key) break
        const body = isRecord(container[key]) ? (container[key] as Record<string, unknown>) : null
        if (!body) break

        const callId = normalizeCallId(line.call_id) ?? normalizeCallId(container.toolCallId)
        if (!callId) break // never emit a tool event we cannot correlate

        const toolName = toolNameFromKey(key)
        const rawArgs = isRecord(body.args) ? body.args : {}
        const ts = resolveTs(line, body, ctx.now)

        if (subtype === 'started') {
          state.openCalls.add(callId)
          append({
            kind: 'tool',
            ts,
            tool: {
              name: toolName,
              callId,
              label: toolLabel(rawArgs),
              args: projectArgs(toolName, rawArgs),
              status: 'running',
            },
          })
          break
        }

        // completed (or any terminal subtype)
        const projection = projectResult(body.result)

        if (state.openCalls.has(callId)) {
          state.openCalls.delete(callId)
          out.push({
            op: 'patch',
            callId,
            patch: { tool: { ...(projection ?? { status: 'success' }), endTs: ts } as Partial<ToolInfo> as any },
          })
          break
        }

        // No matching `started` — in-memory state was lost (server restart) or
        // the client replayed mid-stream. Append a complete event instead; the
        // store upgrades this back into a patch if it knows the callId.
        append({
          kind: 'tool',
          ts,
          tool: {
            name: toolName,
            callId,
            label: toolLabel(rawArgs),
            args: projectArgs(toolName, rawArgs),
            status: 'success',
            ...(projection ?? {}),
            endTs: ts,
          },
        })
        break
      }

      default: {
        append({
          kind: 'other',
          ts: resolveTs(line, null, ctx.now),
          meta: { vendorType: type, vendorSubtype: subtype },
        })
      }
    }
  }

  // Deliberately do NOT flush at end of batch: a delta burst that spans two
  // batches must coalesce into one event, so the buffer carries over in state.
  // The terminator, or the next foreign event, flushes it.
  return out
}

export const cursorStreamJsonAdapter: FormatAdapter = {
  name: 'cursor-stream-json',
  version: 1,
  createState,
  normalize,
}
