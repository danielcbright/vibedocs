import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApiClient, ApiError } from '@/lib/api-client'

describe('createApiClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
  })

  describe('getProjects', () => {
    it('fetches /api/projects with the fileType query and returns json.data', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ name: 'argus', hasDocsFolder: true, tree: [] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      const client = createApiClient({ fetch: fetchSpy })

      const result = await client.getProjects('markdown')

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/projects?fileType=markdown')
      expect(result).toEqual([{ name: 'argus', hasDocsFolder: true, tree: [] }])
    })

    it('returns [] if json.data is missing', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const client = createApiClient({ fetch: fetchSpy })
      expect(await client.getProjects('all')).toEqual([])
    })

    it('throws ApiError when the response is not ok', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 500 }))
      const client = createApiClient({ fetch: fetchSpy })
      await expect(client.getProjects('all')).rejects.toBeInstanceOf(ApiError)
    })
  })

  describe('renderDoc', () => {
    it('fetches /api/render/:project/:path and returns { html, toc }', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { html: '<p>hi</p>', toc: [{ level: 1, id: 'a', text: 'A' }] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      const client = createApiClient({ fetch: fetchSpy })

      const result = await client.renderDoc('argus', 'docs/install.md')

      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/render/argus/docs/install.md',
        expect.anything(),
      )
      expect(result).toEqual({
        html: '<p>hi</p>',
        toc: [{ level: 1, id: 'a', text: 'A' }],
      })
    })

    it('encodes the project name but preserves slashes in the doc path', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { html: '', toc: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const client = createApiClient({ fetch: fetchSpy })

      await client.renderDoc('my project', 'a/b/c.md')

      expect(fetchSpy.mock.calls[0][0]).toBe('/api/render/my%20project/a/b/c.md')
    })

    it('throws ApiError carrying the server error message on non-ok', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const client = createApiClient({ fetch: fetchSpy })

      await expect(client.renderDoc('p', 'x.md')).rejects.toMatchObject({
        message: 'not found',
        status: 404,
      })
    })

    it('falls back to a generic message when the error body is unparseable', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('<!doctype html>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        }),
      )
      const client = createApiClient({ fetch: fetchSpy })
      await expect(client.renderDoc('p', 'x.md')).rejects.toMatchObject({
        message: 'Failed to load',
        status: 500,
      })
    })
  })

  describe('getRawDoc', () => {
    it('fetches /api/raw/:project/:path and returns the body as text', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('# Hello', { status: 200 }))
      const client = createApiClient({ fetch: fetchSpy })

      const result = await client.getRawDoc('argus', 'README.md')

      expect(fetchSpy).toHaveBeenCalledWith('/api/raw/argus/README.md', expect.anything())
      expect(result).toBe('# Hello')
    })

    it('throws ApiError with the HTTP status on non-ok', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 500 }))
      const client = createApiClient({ fetch: fetchSpy })
      await expect(client.getRawDoc('p', 'x.md')).rejects.toMatchObject({ status: 500 })
    })
  })

  describe('search', () => {
    it('fetches /api/search?q=… and returns json.data', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ project: 'a', path: 'b.md', filename: 'b.md', snippet: '...' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      const client = createApiClient({ fetch: fetchSpy })

      const result = await client.search('hello world')

      expect(fetchSpy.mock.calls[0][0]).toBe('/api/search?q=hello%20world')
      expect(result).toEqual([{ project: 'a', path: 'b.md', filename: 'b.md', snippet: '...' }])
    })

    it('forwards an AbortSignal so callers can cancel stale searches', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const client = createApiClient({ fetch: fetchSpy })
      const controller = new AbortController()
      await client.search('hi', { signal: controller.signal })

      const init = fetchSpy.mock.calls[0][1]
      expect(init?.signal).toBe(controller.signal)
    })
  })

  describe('getConfig', () => {
    it('fetches /api/config and returns the parsed body', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadEnabled: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const client = createApiClient({ fetch: fetchSpy })

      const result = await client.getConfig()

      expect(fetchSpy.mock.calls[0][0]).toBe('/api/config')
      expect(result).toEqual({ uploadEnabled: true })
    })

    it('returns safe defaults on non-ok response — config must never throw', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 500 }))
      const client = createApiClient({ fetch: fetchSpy })

      expect(await client.getConfig()).toEqual({ uploadEnabled: false })
    })

    it('returns safe defaults on network failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('network down'))
      const client = createApiClient({ fetch: fetchSpy })

      expect(await client.getConfig()).toEqual({ uploadEnabled: false })
    })
  })

  describe('ApiError', () => {
    it('preserves status and message for downstream consumers', () => {
      const err = new ApiError('boom', 503)
      expect(err.message).toBe('boom')
      expect(err.status).toBe(503)
      expect(err).toBeInstanceOf(Error)
    })
  })
})
