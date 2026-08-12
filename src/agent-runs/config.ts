/**
 * Agent Runs configuration — two halves, deliberately separate.
 *
 *   env  (parseAgentRunsEnv)          enablement, storage location, ingest token
 *   file (loadAgentRunsClientConfig)  linkify rules + editor scheme, handed to the browser
 *
 * The feature is OFF unless VIBEDOCS_RUNS_ENABLED is truthy, so an upstream user
 * who never dispatches an agent gets no extra nav and no extra endpoints.
 */

import { readFile } from 'fs/promises'
import path from 'path'
import {
  EMPTY_AGENT_RUNS_CLIENT_CONFIG,
  MAX_LINKIFY_RULES,
  isSafeUrlTemplate,
  type AgentRunsClientConfig,
  type LinkifyRule,
} from '../shared/agent-runs-config-types.js'
import type { LinkKind } from '../shared/agent-run-types.js'

export const CONFIG_FILENAME = 'agent-runs.json'

const TRUTHY = new Set(['true', '1', 'yes', 'on'])
const VALID_KINDS: readonly LinkKind[] = ['issue', 'pr', 'ci', 'other']

function isTruthy(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.toLowerCase().trim())
}

export interface AgentRunsEnvConfig {
  enabled: boolean
  runsDir: string
  token: string | null
}

export function parseAgentRunsEnv(
  env: Record<string, string | undefined>,
  home: string,
): AgentRunsEnvConfig {
  const explicit = env.VIBEDOCS_RUNS_DIR?.trim()
  const runsDir = explicit ? path.resolve(explicit) : path.join(home, '.vibedocs', 'runs')
  const tokenRaw = env.VIBEDOCS_RUNS_TOKEN
  const token = tokenRaw && tokenRaw.trim().length > 0 ? tokenRaw : null
  return { enabled: isTruthy(env.VIBEDOCS_RUNS_ENABLED), runsDir, token }
}

/** Keep only rules that are complete, compilable, and not a dangerous scheme. */
function sanitizeRules(input: unknown): LinkifyRule[] {
  if (!Array.isArray(input)) return []
  const out: LinkifyRule[] = []
  for (const raw of input) {
    if (out.length >= MAX_LINKIFY_RULES) break
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const pattern = typeof r.pattern === 'string' ? r.pattern : null
    const url = typeof r.url === 'string' ? r.url : null
    if (!pattern || !url) continue
    if (!isSafeUrlTemplate(url)) continue
    try {
      new RegExp(pattern) // reject an unparseable pattern at load, not per row
    } catch {
      continue
    }
    const kindRaw = typeof r.kind === 'string' ? (r.kind as LinkKind) : 'other'
    const kind = VALID_KINDS.includes(kindRaw) ? kindRaw : 'other'
    const flags = typeof r.flags === 'string' ? r.flags : undefined
    out.push({ pattern, url, kind, ...(flags ? { flags } : {}) })
  }
  return out
}

/**
 * Read <runsDir>/../agent-runs.json. Any failure — missing, unreadable,
 * malformed — degrades to empty config. A broken config file must never stop
 * the server from starting.
 */
export async function loadAgentRunsClientConfig(runsDir: string): Promise<AgentRunsClientConfig> {
  const file = path.join(path.dirname(runsDir), CONFIG_FILENAME)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return { ...EMPTY_AGENT_RUNS_CLIENT_CONFIG }
  }
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_AGENT_RUNS_CLIENT_CONFIG }
  const obj = parsed as Record<string, unknown>

  const schemeRaw = typeof obj.editorScheme === 'string' ? obj.editorScheme.trim() : ''
  const editorScheme = schemeRaw.length > 0 && isSafeUrlTemplate(schemeRaw) ? schemeRaw : null

  return { linkify: sanitizeRules(obj.linkify), editorScheme }
}

export interface CompiledLinkifyRule {
  regex: RegExp
  url: string
  kind: LinkKind
}

/** Compile once at load; linkify runs per rendered row and must not recompile. */
export function compileLinkifyRules(rules: readonly LinkifyRule[]): CompiledLinkifyRule[] {
  const out: CompiledLinkifyRule[] = []
  for (const rule of rules) {
    const flags = new Set(['g', ...(rule.flags ?? '')])
    try {
      out.push({ regex: new RegExp(rule.pattern, [...flags].join('')), url: rule.url, kind: rule.kind })
    } catch {
      continue
    }
  }
  return out
}
