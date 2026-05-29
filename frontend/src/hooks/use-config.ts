import { useState, useEffect } from "react"
import { apiClient, type ApiClient, type ServerConfig } from "@/lib/api-client"

export type { ServerConfig }

const DEFAULT_CONFIG: ServerConfig = { uploadEnabled: false }

/**
 * Fetches /api/config once on mount. Safe defaults (uploadEnabled=false)
 * apply while loading and on fetch failure — the upload UI stays hidden
 * unless the server explicitly says it's available. The client itself
 * normalises errors to defaults, so this hook only has to thread the value
 * through React state.
 */
export function useConfig(client: ApiClient = apiClient): ServerConfig {
  const [config, setConfig] = useState<ServerConfig>(DEFAULT_CONFIG)

  useEffect(() => {
    let cancelled = false
    client
      .getConfig()
      .then((next) => {
        if (cancelled) return
        setConfig(next)
      })
      .catch(() => {
        // Defensive — the client already swallows errors, but stay on
        // safe defaults if anything slips through.
      })
    return () => {
      cancelled = true
    }
  }, [client])

  return config
}
