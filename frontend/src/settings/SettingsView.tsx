import { useCallback } from "react"
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FolderTree } from "./FolderTree"
import { useRootsPicker, type SaveState, type UseRootsPickerOptions } from "./use-roots-picker"
import type { SettingsClient } from "./settings-client"

/**
 * Choose roots: the Settings view in the app, and the whole page of the one-shot
 * install picker. Same component, same API; `variant` only changes the framing
 * and what a save means (`afterSave` comes from the server).
 */
export interface SettingsViewProps {
  client: SettingsClient
  variant?: "app" | "install"
  pickerOptions?: UseRootsPickerOptions
}

export function SettingsView({ client, variant = "app", pickerOptions }: SettingsViewProps) {
  const picker = useRootsPicker(client, pickerOptions)
  const { settings, loadError, selection, check, dirty, saveState } = picker
  const home = settings?.home ?? ""
  const tilde = useCallback(
    (p: string) => (home && (p === home || p.startsWith(home + "/")) ? "~" + p.slice(home.length) : p),
    [home],
  )

  const busy = saveState.kind === "saving" || saveState.kind === "restarting"
  const finished = saveState.kind === "saved" && saveState.afterSave === "done"
  const pending =
    settings?.saved != null && !sameList(settings.saved, settings.roots) && saveState.kind === "idle"

  return (
    <div className={variant === "install" ? "min-h-screen bg-background text-foreground" : "h-full overflow-auto"}>
      <div className="mx-auto max-w-3xl space-y-5 p-6">
        <header className="space-y-1.5">
          <h1 className="text-lg font-semibold">{variant === "install" ? "Choose folders for VibeDocs" : "Roots"}</h1>
          <p className="text-sm text-muted-foreground">
            Each folder you tick is a root. The folders directly inside a root are its projects, so ticking a folder of
            repositories makes every repository a project.
          </p>
        </header>

        {loadError && <Notice tone="error">{loadError}</Notice>}
        {!settings && !loadError && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        )}

        {settings && !settings.editable && (
          <>
            <Notice tone="info">{settings.reason}</Notice>
            <RootList roots={settings.roots} tilde={tilde} />
          </>
        )}

        {settings?.editable && (
          <>
            {pending && (
              <Notice tone="info">
                The roots file has a selection this server is not running yet. Restart VibeDocs to apply it.
              </Notice>
            )}
            <FolderTree
              client={client}
              root={settings.home}
              selected={selection}
              onToggle={picker.toggle}
              disabled={busy || finished}
            />
            <section className="space-y-2" aria-label="Chosen roots">
              <h2 className="text-sm font-medium">Roots ({selection.length})</h2>
              <RootList roots={selection} tilde={tilde} onRemove={busy || finished ? undefined : picker.remove} />
              {dirty && check === null && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Checking…
                </p>
              )}
              {check && !check.ok && <Notice tone="error">{check.error}</Notice>}
            </section>
            <div className="flex items-center gap-2">
              {/* The installer waits on this page, so keeping the current roots must be a
                  choice too; in Settings an unchanged save would only restart for nothing. */}
              <Button
                onClick={() => void picker.save()}
                disabled={(!dirty && variant !== "install") || !check?.ok || busy || finished}
              >
                {variant === "install" ? "Use these folders" : "Save roots"}
              </Button>
              {dirty && !busy && !finished && (
                <Button variant="ghost" onClick={picker.reset}>
                  Undo changes
                </Button>
              )}
            </div>
            <SaveStatus state={saveState} />
          </>
        )}
      </div>
    </div>
  )
}

function RootList({
  roots,
  tilde,
  onRemove,
}: {
  roots: readonly string[]
  tilde: (p: string) => string
  onRemove?: (p: string) => void
}) {
  if (roots.length === 0) return <p className="text-sm text-muted-foreground">None chosen.</p>
  return (
    <ul className="flex flex-wrap gap-1.5">
      {roots.map((r) => (
        <li key={r} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 pr-1 font-mono text-xs" title={r}>
          {tilde(r)}
          {onRemove && (
            <button
              type="button"
              className="tap-target rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${r}`}
              onClick={() => onRemove(r)}
            >
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function SaveStatus({ state }: { state: SaveState }) {
  switch (state.kind) {
    case "idle":
      return null
    case "saving":
      return <p className="text-sm text-muted-foreground">Saving…</p>
    case "error":
      return <Notice tone="error">{state.message}</Notice>
    case "saved":
      return state.afterSave === "done" ? (
        <Notice tone="ok">Saved. You can close this tab; the installer is carrying on in your terminal.</Notice>
      ) : (
        <Notice tone="ok">Saved to the roots file. Restart VibeDocs to serve them.</Notice>
      )
    case "restarting":
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" /> Restarting VibeDocs on the new roots…
        </p>
      )
    case "restarted":
      return (
        <div className="flex items-center gap-3">
          <Notice tone="ok">VibeDocs is serving the new roots.</Notice>
          <Button variant="outline" size="sm" onClick={() => window.location.assign("/")}>
            Back to docs
          </Button>
        </div>
      )
    case "restart-timeout":
      return (
        <Notice tone="error">
          VibeDocs has not come back after a minute. Check ~/.vibedocs/vibedocs.error.log. A root under Documents,
          Desktop or Downloads needs Full Disk Access granted to node.
        </Notice>
      )
  }
}

function Notice({ tone, children }: { tone: "error" | "info" | "ok"; children: React.ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle
  const color =
    tone === "error"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : tone === "ok"
        ? "border-green-600/30 bg-green-500/5 text-green-700 dark:text-green-400"
        : "border-border bg-muted/40 text-foreground"
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${color}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
