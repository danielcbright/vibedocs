import { useState, useEffect } from "react"

export interface ServerConfig {
  /** True iff the server has VIBEDOCS_UPLOAD_TOKEN set AND VIBEDOCS_READ_ONLY is not set.
   *  Frontend uses this to hide upload affordances on deployments where
   *  POST /api/upload/* would return 404. */
  uploadEnabled: boolean
}

const DEFAULT_CONFIG: ServerConfig = { uploadEnabled: false }

/**
 * Fetches /api/config once on mount. Safe defaults (uploadEnabled=false)
 * apply while loading and on fetch failure — the upload UI stays hidden
 * unless the server explicitly says it's available.
 */
export function useConfig(): ServerConfig {
  const [config, setConfig] = useState<ServerConfig>(DEFAULT_CONFIG)

  useEffect(() => {
    let cancelled = false
    fetch("/api/config")
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        if (typeof json?.uploadEnabled === "boolean") {
          setConfig({ uploadEnabled: json.uploadEnabled })
        }
      })
      .catch(() => {
        // Stay on safe defaults if config endpoint is unreachable
      })
    return () => {
      cancelled = true
    }
  }, [])

  return config
}
