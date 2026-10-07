/**
 * Wire types for `/api/settings/*` — the roots picker shared by the Settings view
 * and the one-shot install page. Both sides import from here.
 */

/** One folder row in the picker. */
export interface FolderEntry {
  name: string
  /** Absolute path. */
  path: string
  /** Markdown files within four levels, or null when not counted (privacy-protected). */
  markdown: number | null
  /** True when counting stopped at the cap, so `markdown` is a lower bound. */
  capped: boolean
  /** macOS privacy-protected (Documents, Desktop, Downloads): a background service needs Full Disk Access. */
  protected: boolean
}

export interface FolderListing {
  /** Absolute path of the folder listed. */
  path: string
  /** Its parent, or null at the top (the home folder). */
  parent: string | null
  folders: FolderEntry[]
}

export interface RootsSettings {
  /** Roots this process is serving. */
  roots: string[]
  /** Roots the roots file lists now, or null when roots do not come from a file. */
  saved: string[] | null
  /** Whether this page may change them. */
  editable: boolean
  /** Why not, when `editable` is false. */
  reason: string | null
  /** Top of the folder tree. */
  home: string
  /** What happens after a save. */
  afterSave: AfterSave
}

/**
 * - `restart`: the server exits and its supervisor (launchd, systemd) starts it on the new roots.
 * - `manual`: nothing supervises it; the operator restarts it.
 * - `done`: the one-shot install page, which hands the selection back to the installer.
 */
export type AfterSave = 'restart' | 'manual' | 'done'

/** Body of `POST /api/settings/roots/check` and `PUT /api/settings/roots`. */
export interface RootsSelection {
  roots: string[]
}

export type RootsCheck = { ok: true; roots: string[] } | { ok: false; error: string }

export interface RootsSaved {
  roots: string[]
  afterSave: AfterSave
}
