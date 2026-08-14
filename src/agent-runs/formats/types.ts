import type { AgentEvent } from '../../shared/agent-run-types.js'

/**
 * A record an adapter wants written, before the store assigns identity.
 *
 * An adapter sees a batch of vendor lines and no global state, so it cannot know
 * seq numbers. A tool completion therefore patches by `callId`; the store
 * resolves callId -> seq (it owns the callId index) and writes a real
 * { op: 'patch', seq } line. See src/agent-runs/store.ts.
 */
export type PendingRecord =
  | { op: 'append'; event: Omit<AgentEvent, 'seq'> }
  | { op: 'patch'; callId: string; patch: Partial<AgentEvent> }

/** Opaque per-run carry-over. Adapters define their own shape. */
export interface AdapterState {
  [key: string]: unknown
}

export interface NormalizeCtx {
  /** Injected clock — server-stamps events the vendor left without a timestamp. */
  now: () => number
}

export interface FormatAdapter {
  /** Wire key, e.g. 'cursor-stream-json'. */
  readonly name: string
  readonly version: number
  createState(): AdapterState
  /**
   * Normalize one batch. `state` carries across batches within a run — a
   * thinking burst or a tool call may span batch boundaries.
   */
  normalize(raw: unknown[], state: AdapterState, ctx: NormalizeCtx): PendingRecord[]
}
