import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useProjects } from '@/hooks/use-projects'
import { useDocument } from '@/hooks/use-document'
import { useSearch } from '@/hooks/use-search'
import { useConfig } from '@/hooks/use-config'
import { ApiError, type ApiClient } from '@/lib/api-client'

/** Build a fully-typed mock client. Tests override only the methods they exercise. */
function makeMockClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getProjects: vi.fn().mockResolvedValue([]),
    renderDoc: vi.fn().mockResolvedValue({ html: '', toc: [] }),
    getRawDoc: vi.fn().mockResolvedValue(''),
    search: vi.fn().mockResolvedValue([]),
    getConfig: vi.fn().mockResolvedValue({ uploadEnabled: false }),
    ...overrides,
  }
}

describe('useProjects with injected client', () => {
  it('calls client.getProjects(fileType) and exposes the result', async () => {
    const fixture = [{ name: 'argus', hasDocsFolder: true, tree: [] }]
    const client = makeMockClient({
      getProjects: vi.fn().mockResolvedValue(fixture),
    })

    const { result } = renderHook(() => useProjects('markdown', client))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.projects).toEqual(fixture)
    expect(client.getProjects).toHaveBeenCalledWith('markdown')
  })

  it('refreshes when fileType changes', async () => {
    const client = makeMockClient({
      getProjects: vi.fn().mockResolvedValue([]),
    })

    const { result, rerender } = renderHook(
      ({ ft }: { ft: 'all' | 'markdown' | 'assets' }) => useProjects(ft, client),
      { initialProps: { ft: 'all' } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ ft: 'assets' })
    await waitFor(() =>
      expect(client.getProjects).toHaveBeenCalledWith('assets'),
    )
  })

  it('still finishes loading when client.getProjects rejects', async () => {
    const client = makeMockClient({
      getProjects: vi.fn().mockRejectedValue(new ApiError('boom', 500)),
    })

    const { result } = renderHook(() => useProjects('all', client))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.projects).toEqual([])
  })
})

describe('useDocument with injected client', () => {
  it('renders document html + toc from client.renderDoc', async () => {
    const client = makeMockClient({
      renderDoc: vi.fn().mockResolvedValue({
        html: '<p>hi</p>',
        toc: [{ level: 1, id: 'a', text: 'A' }],
      }),
    })

    const { result } = renderHook(() => useDocument('argus', 'docs/a.md', client))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.html).toBe('<p>hi</p>')
    expect(result.current.toc).toEqual([{ level: 1, id: 'a', text: 'A' }])
    expect(client.renderDoc).toHaveBeenCalledWith('argus', 'docs/a.md')
  })

  it('skips fetching when project or path is null', async () => {
    const client = makeMockClient()
    const { result } = renderHook(() => useDocument(null, null, client))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(client.renderDoc).not.toHaveBeenCalled()
  })

  it('sets error message from ApiError thrown by the client', async () => {
    const client = makeMockClient({
      renderDoc: vi.fn().mockRejectedValue(new ApiError('not found', 404)),
    })

    const { result } = renderHook(() => useDocument('p', 'x.md', client))

    await waitFor(() => expect(result.current.error).toBe('not found'))
    expect(result.current.html).toBe('')
  })
})

describe('useSearch with injected client', () => {
  it('debounces and calls client.search with the trimmed query', async () => {
    vi.useFakeTimers()
    const client = makeMockClient({
      search: vi
        .fn()
        .mockResolvedValue([{ project: 'a', path: 'b.md', filename: 'b.md', snippet: '...' }]),
    })

    const { result } = renderHook(() => useSearch('  hi  ', client))

    // Below 250ms — no call yet
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(client.search).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    vi.useRealTimers()
    await waitFor(() =>
      expect(client.search).toHaveBeenCalledWith('hi', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.results).toHaveLength(1)
  })

  it('skips the client when query is shorter than 2 chars', async () => {
    const client = makeMockClient()
    const { result } = renderHook(() => useSearch('a', client))
    // Give the debounce a tick — nothing should fire
    await new Promise((r) => setTimeout(r, 300))
    expect(client.search).not.toHaveBeenCalled()
    expect(result.current.results).toEqual([])
  })
})

describe('useConfig with injected client', () => {
  it('hydrates from client.getConfig', async () => {
    const client = makeMockClient({
      getConfig: vi.fn().mockResolvedValue({ uploadEnabled: true }),
    })

    const { result } = renderHook(() => useConfig(client))

    await waitFor(() => expect(result.current.uploadEnabled).toBe(true))
    expect(client.getConfig).toHaveBeenCalled()
  })
})
