import { useEffect, useState } from "react"
import { EMPTY_AGENT_RUNS_CLIENT_CONFIG, type AgentRunsClientConfig } from "@shared/agent-runs-config-types"
import { compileRules, type CompiledRule } from "../lib/linkify"

/**
 * Linkify rules from the server. Best-effort: a failure yields no rules, which
 * degrades to plain text rather than breaking the transcript.
 */
export function useRunsConfig(enabled: boolean): { config: AgentRunsClientConfig; rules: CompiledRule[] } {
  const [config, setConfig] = useState<AgentRunsClientConfig>(EMPTY_AGENT_RUNS_CLIENT_CONFIG)
  const [rules, setRules] = useState<CompiledRule[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch("/api/runs/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.data) return
        setConfig(body.data)
        setRules(compileRules(body.data))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [enabled])

  return { config, rules }
}
