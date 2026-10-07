import { useMemo } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { SettingsView } from "./SettingsView"
import { createSettingsClient } from "./settings-client"

/**
 * The one-shot install page (`vibedocs pick-roots`): the roots picker and nothing
 * else. That server answers only `/api/settings/*`, so the docs chrome — which
 * would fetch projects and open a socket — is not mounted at all.
 */
export function SetupPage({ token }: { token: string }) {
  const client = useMemo(() => createSettingsClient({ setupToken: token }), [token])
  return (
    <ThemeProvider>
      <SettingsView client={client} variant="install" />
    </ThemeProvider>
  )
}
