import { useCallback, useEffect, useRef, useState } from "react"
import type { AfterSave, RootsCheck, RootsSettings } from "@shared/settings-types"
import { ApiError } from "@/lib/api-client"
import type { SettingsClient } from "./settings-client"

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  /** Written; `afterSave` says what happens next. */
  | { kind: "saved"; afterSave: Exclude<AfterSave, "restart"> }
  /** Written; waiting for the supervisor to bring the server back on the new roots. */
  | { kind: "restarting" }
  | { kind: "restarted" }
  | { kind: "restart-timeout" }

export interface RootsPicker {
  settings: RootsSettings | null
  loadError: string | null
  selection: string[]
  toggle: (path: string, checked: boolean) => void
  remove: (path: string) => void
  reset: () => void
  /** The server's verdict on the current selection; null while it is being asked. */
  check: RootsCheck | null
  dirty: boolean
  save: () => Promise<void>
  saveState: SaveState
}

export interface UseRootsPickerOptions {
  /** How long to wait after a change before asking the server about it. */
  checkDelayMs?: number
  /** Restart polling cadence and patience. */
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

export function useRootsPicker(client: SettingsClient, opts: UseRootsPickerOptions = {}): RootsPicker {
  const { checkDelayMs = 250, pollIntervalMs = 1000, pollTimeoutMs = 60_000 } = opts
  const [settings, setSettings] = useState<RootsSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [check, setCheck] = useState<RootsCheck | null>(null)
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" })
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    client
      .getRoots()
      .then((s) => {
        if (!mounted.current) return
        setSettings(s)
        // Start from what the next boot will use: a saved-but-not-applied file wins
        // over what is running, or the page would offer to undo the operator's save.
        setSelection(s.saved ?? s.roots)
      })
      .catch((err: Error) => {
        if (!mounted.current) return
        // 404 is the feature switched off, not a broken server.
        setLoadError(
          err instanceof ApiError && err.status === 404
            ? "Settings are turned off on this server. Set VIBEDOCS_SETTINGS_ENABLED=true to choose roots here."
            : err.message,
        )
      })
    return () => {
      mounted.current = false
    }
  }, [client])

  const baseline = settings ? (settings.saved ?? settings.roots) : []
  const dirty = !sameList(selection, baseline)

  useEffect(() => {
    if (!settings?.editable) return
    setCheck(null)
    const timer = setTimeout(() => {
      client
        .check(selection)
        .then((c) => mounted.current && setCheck(c))
        .catch((err: Error) => mounted.current && setCheck({ ok: false, error: err.message }))
    }, checkDelayMs)
    return () => clearTimeout(timer)
  }, [client, selection, settings?.editable, checkDelayMs])

  // Appends rather than sorts: order decides which root keeps a shared project
  // name, and appending never renames a project that already has one.
  const toggle = useCallback((path: string, checked: boolean) => {
    setSaveState({ kind: "idle" })
    setSelection((cur) => (checked ? (cur.includes(path) ? cur : [...cur, path]) : cur.filter((p) => p !== path)))
  }, [])
  const remove = useCallback((path: string) => toggle(path, false), [toggle])
  const reset = useCallback(() => {
    setSaveState({ kind: "idle" })
    if (settings) setSelection(settings.saved ?? settings.roots)
  }, [settings])

  const save = useCallback(async () => {
    setSaveState({ kind: "saving" })
    let saved
    try {
      saved = await client.save(selection)
    } catch (err) {
      setSaveState({ kind: "error", message: (err as Error).message })
      return
    }
    setSettings((s) => (s ? { ...s, saved: saved.roots } : s))
    if (saved.afterSave !== "restart") {
      setSaveState({ kind: "saved", afterSave: saved.afterSave })
      return
    }

    setSaveState({ kind: "restarting" })
    const deadline = Date.now() + pollTimeoutMs
    while (mounted.current && Date.now() < deadline) {
      await sleep(pollIntervalMs)
      try {
        const now = await client.getRoots()
        // The old process answers for a moment before it exits, so "it answered"
        // is not enough: it must be serving the roots just saved.
        if (sameList(now.roots, saved.roots)) {
          if (mounted.current) {
            setSettings(now)
            setSaveState({ kind: "restarted" })
          }
          return
        }
      } catch {
        // Down between the old process and the new one.
      }
    }
    if (mounted.current) setSaveState({ kind: "restart-timeout" })
  }, [client, selection, pollIntervalMs, pollTimeoutMs])

  return { settings, loadError, selection, toggle, remove, reset, check, dirty, save, saveState }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
