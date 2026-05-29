import type { ProjectInfo, FileTypeFilter } from "@/hooks/use-projects"

export interface TocEntry {
  level: number
  id: string
  text: string
}

export interface RenderedDoc {
  html: string
  toc: TocEntry[]
}

export interface SearchResult {
  project: string
  path: string
  filename: string
  snippet: string
}

export interface ServerConfig {
  uploadEnabled: boolean
}

export interface RequestOptions {
  signal?: AbortSignal
}

export interface ApiClient {
  getProjects(fileType: FileTypeFilter, opts?: RequestOptions): Promise<ProjectInfo[]>
  renderDoc(project: string, docPath: string, opts?: RequestOptions): Promise<RenderedDoc>
  getRawDoc(project: string, docPath: string, opts?: RequestOptions): Promise<string>
  search(query: string, opts?: RequestOptions): Promise<SearchResult[]>
  getConfig(opts?: RequestOptions): Promise<ServerConfig>
}

/**
 * Single error type the client raises so callers (hooks, components) can
 * branch on `status` and surface a normalised `message`. Keeps each hook
 * free of bespoke `if (!res.ok)` plumbing.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

const DEFAULT_CONFIG: ServerConfig = { uploadEnabled: false }

type FetchFn = typeof fetch

export interface CreateApiClientOptions {
  /** Inject a fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: FetchFn
}

/**
 * Encode the project segment (handles spaces, slashes in names) without
 * touching the doc path — paths legitimately contain `/` separators that
 * the server route patterns rely on.
 */
function buildPath(project: string, docPath: string, base: string): string {
  return `${base}/${encodeURIComponent(project)}/${docPath}`
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (body && typeof body.error === "string") return body.error
  } catch {
    /* fall through */
  }
  return fallback
}

export function createApiClient(options: CreateApiClientOptions = {}): ApiClient {
  const doFetch: FetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)

  return {
    async getProjects(fileType, opts) {
      const res = await doFetch(`/api/projects?fileType=${fileType}`, {
        signal: opts?.signal,
      })
      if (!res.ok) {
        throw new ApiError(await readErrorMessage(res, "Failed to load projects"), res.status)
      }
      const json = (await res.json()) as { data?: ProjectInfo[] }
      return json.data ?? []
    },

    async renderDoc(project, docPath, opts) {
      const res = await doFetch(buildPath(project, docPath, "/api/render"), {
        signal: opts?.signal,
      })
      if (!res.ok) {
        throw new ApiError(await readErrorMessage(res, "Failed to load"), res.status)
      }
      const json = (await res.json()) as { data?: Partial<RenderedDoc> }
      return {
        html: json.data?.html ?? "",
        toc: json.data?.toc ?? [],
      }
    },

    async getRawDoc(project, docPath, opts) {
      const res = await doFetch(buildPath(project, docPath, "/api/raw"), {
        signal: opts?.signal,
      })
      if (!res.ok) {
        throw new ApiError(`HTTP ${res.status}`, res.status)
      }
      return await res.text()
    },

    async search(query, opts) {
      const res = await doFetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: opts?.signal,
      })
      if (!res.ok) {
        throw new ApiError(await readErrorMessage(res, "Search failed"), res.status)
      }
      const json = (await res.json()) as { data?: SearchResult[] }
      return json.data ?? []
    },

    async getConfig(opts) {
      // Config is best-effort: failures must not break the UI. Callers fall
      // back to safe defaults (upload UI hidden).
      try {
        const res = await doFetch("/api/config", { signal: opts?.signal })
        if (!res.ok) return DEFAULT_CONFIG
        const json = (await res.json()) as Partial<ServerConfig>
        if (typeof json?.uploadEnabled === "boolean") {
          return { uploadEnabled: json.uploadEnabled }
        }
        return DEFAULT_CONFIG
      } catch {
        return DEFAULT_CONFIG
      }
    },
  }
}

/** Default singleton used by hooks when no client is injected. */
export const apiClient: ApiClient = createApiClient()
