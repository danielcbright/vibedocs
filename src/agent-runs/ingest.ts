/**
 * Ingest — the seam between "raw vendor lines arrived" and "records written,
 * clients nudged". Knows nothing about HTTP and nothing about any vendor.
 *
 * Its one piece of state is a per-run adapter state carrying a thinking buffer
 * and the set of open tool calls across batches. That state is in-memory and
 * bounded; losing it is survivable by design, because the store rebuilds its
 * callId index from disk and upgrades the resulting duplicate append back into
 * a patch (see src/agent-runs/store.ts). That is what lets the eviction policy
 * here stay this simple.
 */

import { getAdapter } from './formats/index.js'
import type { AdapterState } from './formats/types.js'
import type { AppendResult, CreateRunInput, PatchRunInput, RunStore } from './store.js'
import type { RunMeta, RunStatus } from '../shared/agent-run-types.js'
import {
  runDeletedMessage,
  runRecordsMessage,
  runUpdatedMessage,
  type WsMessage,
} from '../shared/ws-messages.js'
import { VibedocsError } from '../errors.js'

/** Once a run reaches one of these, no further events are expected. */
const TERMINAL_STATUSES: readonly RunStatus[] = ['done', 'failed', 'stopped']

const DEFAULT_MAX_ADAPTER_STATES = 64

export interface IngestDeps {
  store: RunStore
  broadcast: (msg: WsMessage) => void
  /** Injected clock — the adapter stamps undated events with it. */
  now?: () => number
  maxAdapterStates?: number
}

export interface Ingest {
  registerRun(input: CreateRunInput): Promise<RunMeta>
  appendRaw(runId: string, format: string, raw: unknown[], clientSeq?: number): Promise<AppendResult>
  updateRun(runId: string, patch: PatchRunInput): Promise<RunMeta>
  /**
   * Remove a run and tell every client. Resolves false when there was nothing
   * there, so the route decides whether absence is a 404.
   */
  deleteRun(runId: string): Promise<boolean>
  forgetAdapterState(runId: string): void
}

export function createIngest(deps: IngestDeps): Ingest {
  const { store, broadcast } = deps
  const now = deps.now ?? (() => Date.now())
  const maxStates = deps.maxAdapterStates ?? DEFAULT_MAX_ADAPTER_STATES

  /** Insertion order is LRU order — re-set on access to move an entry to the end. */
  const states = new Map<string, AdapterState>()

  function requireAdapter(format: string) {
    const adapter = getAdapter(format)
    if (!adapter) throw new VibedocsError('invalid', `Unknown run format: ${format}`)
    return adapter
  }

  function stateFor(runId: string, format: string): AdapterState {
    const adapter = requireAdapter(format)
    const existing = states.get(runId)
    if (existing) {
      states.delete(runId)
      states.set(runId, existing) // refresh LRU position
      return existing
    }
    const fresh = adapter.createState()
    states.set(runId, fresh)
    while (states.size > maxStates) {
      const oldest = states.keys().next().value as string | undefined
      if (oldest === undefined) break
      states.delete(oldest)
    }
    return fresh
  }

  return {
    async registerRun(input) {
      requireAdapter(input.format) // reject before touching the disk
      const meta = await store.createRun(input)
      broadcast(runUpdatedMessage(meta.id))
      return meta
    },

    async appendRaw(runId, format, raw, clientSeq) {
      const adapter = requireAdapter(format)
      const meta = await store.getRun(runId)
      if (!meta) throw new VibedocsError('not-found', `Run not found: ${runId}`)

      const pending = adapter.normalize(raw, stateFor(runId, format), { now })
      const result = await store.appendRecords(runId, pending, clientSeq)

      // Nudge only. The message carries a count, never the payload — clients
      // fetch ?fromRec=, which is the same path reconnect catch-up uses.
      if (result.appended > 0) broadcast(runRecordsMessage(runId, result.recCount))
      return result
    },

    async updateRun(runId, patch) {
      const meta = await store.patchRun(runId, patch)
      if (patch.status !== undefined && TERMINAL_STATUSES.includes(patch.status)) {
        states.delete(runId)
      }
      broadcast(runUpdatedMessage(runId))
      return meta
    },

    async deleteRun(runId) {
      const deleted = await store.deleteRun(runId)
      if (!deleted) return false
      // Drop the adapter state too: a run re-registered under this id must not
      // inherit half-parsed vendor state from the run that used to own it.
      states.delete(runId)
      broadcast(runDeletedMessage(runId))
      return true
    },

    forgetAdapterState(runId) {
      states.delete(runId)
    },
  }
}
