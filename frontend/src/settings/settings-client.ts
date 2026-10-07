import { ApiError, readErrorMessage } from "@/lib/api-client"
import type {
  FolderListing,
  RootsCheck,
  RootsSaved,
  RootsSettings,
} from "@shared/settings-types"
import type { VisibilityRules } from "@shared/project-visibility"

/**
 * Client for `/api/settings/*`, used by the Settings view and the one-shot
 * install page alike. The install page's server also wants its one-time token on
 * every request; the live server ignores the header.
 */
export interface SettingsClient {
  getRoots(): Promise<RootsSettings>
  listFolders(path?: string): Promise<FolderListing>
  check(roots: string[], rules?: VisibilityRules): Promise<RootsCheck>
  save(roots: string[], rules?: VisibilityRules): Promise<RootsSaved>
}

export const SETUP_TOKEN_HEADER = "X-Vibedocs-Setup-Token"

export interface CreateSettingsClientOptions {
  fetch?: typeof fetch
  /** One-time token of the install page, read from its `?setup=` query parameter. */
  setupToken?: string | null
}

export function createSettingsClient(options: CreateSettingsClientOptions = {}): SettingsClient {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const tokenHeader: Record<string, string> = options.setupToken
    ? { [SETUP_TOKEN_HEADER]: options.setupToken }
    : {}

  async function call<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
    const res = await doFetch(url, {
      ...init,
      headers: { ...tokenHeader, ...(init.headers as Record<string, string> | undefined) },
    })
    if (!res.ok) throw new ApiError(await readErrorMessage(res, fallback), res.status)
    return ((await res.json()) as { data: T }).data
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  return {
    getRoots: () => call("/api/settings/roots", {}, "Failed to load settings"),
    listFolders: (path) =>
      call(
        path ? `/api/settings/folders?path=${encodeURIComponent(path)}` : "/api/settings/folders",
        {},
        "Failed to list folders",
      ),
    check: (roots, rules) => call("/api/settings/roots/check", json("POST", { roots, rules }), "Failed to check folders"),
    save: (roots, rules) => call("/api/settings/roots", json("PUT", { roots, rules }), "Failed to save"),
  }
}

/** The install page's token, when this page is the install page. */
export function setupTokenFromLocation(search: string = window.location.search): string | null {
  return new URLSearchParams(search).get("setup")
}
