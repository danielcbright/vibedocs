/**
 * Format-adapter registry.
 *
 * Adding an adapter (Claude Code JSONL is next) is a one-line change here plus
 * a new file beside it — by design, neither ingest nor the UI is touched.
 */
import type { FormatAdapter } from './types.js'
import { cursorStreamJsonAdapter } from './cursor-stream-json.js'

const ADAPTERS: readonly FormatAdapter[] = [cursorStreamJsonAdapter]

export function getAdapter(format: string): FormatAdapter | null {
  return ADAPTERS.find((a) => a.name === format) ?? null
}

export function knownFormats(): string[] {
  return ADAPTERS.map((a) => a.name)
}

export type { FormatAdapter, PendingRecord, AdapterState, NormalizeCtx } from './types.js'
