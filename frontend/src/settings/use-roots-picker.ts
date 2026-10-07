import { useCallback, useEffect, useRef, useState } from "react"
import type { AfterSave, RootsCheck, RootsSettings } from "@shared/settings-types"
import { NO_RULES, projectVisibility, type VisibilityRules } from "@shared/project-visibility"
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
  /** Draft hide/show rules (ADR-0003), saved with the roots. */
  rules: VisibilityRules
  /** Flip one project between shown and hidden. */
  toggleHidden: (projectDir: string, root: string, isWorktree: boolean) => void
  /** Per root: hide its git worktrees (the default) or list them. */
  setHideWorktrees: (root: string, hide: boolean) => void
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
  const [rules, setRules] = useState<VisibilityRules>(NO_RULES)
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
        setRules(s.rules)
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
  const dirty = !sameList(selection, baseline) || (settings !== null && !sameRules(rules, settings.rules))

  useEffect(() => {
    if (!settings?.editable) return
    setCheck(null)
    const timer = setTimeout(() => {
      client
        .check(selection, rules)
        .then((c) => mounted.current && setCheck(c))
        .catch((err: Error) => mounted.current && setCheck({ ok: false, error: err.message }))
    }, checkDelayMs)
    return () => clearTimeout(timer)
  }, [client, selection, rules, settings?.editable, checkDelayMs])

  // Appends rather than sorts: order decides which root keeps a shared project
  // name, and appending never renames a project that already has one.
  const toggle = useCallback((path: string, checked: boolean) => {
    setSaveState({ kind: "idle" })
    setSelection((cur) => (checked ? (cur.includes(path) ? cur : [...cur, path]) : cur.filter((p) => p !== path)))
  }, [])
  const remove = useCallback((path: string) => toggle(path, false), [toggle])

  // Each flip edits the smallest rule that produces it: a hidden-by-hand project
  // loses its `hide`, a hidden worktree gains a `show`, and back. The outcome is
  // previewed with the same function the server decides with.
  const toggleHidden = useCallback((projectDir: string, root: string, isWorktree: boolean) => {
    setSaveState({ kind: "idle" })
    setRules((cur) => {
      const without = (list: readonly string[]) => list.filter((p) => p !== projectDir)
      const v = projectVisibility(projectDir, root, isWorktree, cur)
      if (v.hidden) {
        return v.reason === "manual"
          ? { ...cur, hide: without(cur.hide) }
          : { ...cur, show: [...without(cur.show), projectDir] }
      }
      return cur.show.includes(projectDir)
        ? { ...cur, show: without(cur.show) }
        : { ...cur, hide: [...without(cur.hide), projectDir] }
    })
  }, [])

  const setHideWorktrees = useCallback((root: string, hide: boolean) => {
    setSaveState({ kind: "idle" })
    setRules((cur) => {
      const rest = cur.showWorktrees.filter((r) => r !== root)
      return { ...cur, showWorktrees: hide ? rest : [...rest, root] }
    })
  }, [])

  const reset = useCallback(() => {
    setSaveState({ kind: "idle" })
    if (settings) {
      setSelection(settings.saved ?? settings.roots)
      setRules(settings.rules)
    }
  }, [settings])

  const save = useCallback(async () => {
    setSaveState({ kind: "saving" })
    let saved
    try {
      saved = await client.save(selection, rules)
    } catch (err) {
      setSaveState({ kind: "error", message: (err as Error).message })
      return
    }
    setSettings((s) => (s ? { ...s, saved: saved.roots, rules: saved.rules } : s))
    setRules(saved.rules)
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
  }, [client, selection, rules, pollIntervalMs, pollTimeoutMs])

  return {
    settings,
    loadError,
    selection,
    toggle,
    remove,
    rules,
    toggleHidden,
    setHideWorktrees,
    reset,
    check,
    dirty,
    save,
    saveState,
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function sameRules(a: VisibilityRules, b: VisibilityRules): boolean {
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((p) => y.includes(p))
  return same(a.hide, b.hide) && same(a.show, b.show) && same(a.showWorktrees, b.showWorktrees)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
