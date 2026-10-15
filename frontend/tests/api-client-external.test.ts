import { describe, it, expect, vi } from 'vitest'
import { createApiClient } from '@/lib/api-client'
import { EXTERNAL_PROJECT } from '@shared/external-file'

/**
 * A doc under EXTERNAL_PROJECT is a file outside every project (`#/file<abs>`);
 * the client must fetch it from `/api/external/*`, not a project route.
 */
function clientCapturing() {
  const urls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input))
    return new Response(JSON.stringify({ data: { html: '<p>x</p>', toc: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return { client: createApiClient({ fetch: fetchMock as unknown as typeof fetch }), urls }
}

describe('api client — external files', () => {
  it('renders an external file through /api/external/render with the absolute path encoded', async () => {
    const { client, urls } = clientCapturing()
    await client.renderDoc(EXTERNAL_PROJECT, '/Users/me/My Notes.md')
    expect(urls[0]).toBe('/api/external/render?path=%2FUsers%2Fme%2FMy%20Notes.md')
  })

  it('reads the raw source through /api/external/raw', async () => {
    const { client, urls } = clientCapturing()
    await client.getRawDoc(EXTERNAL_PROJECT, '/Users/me/a.md')
    expect(urls[0]).toBe('/api/external/raw?path=%2FUsers%2Fme%2Fa.md')
  })

  it('leaves project docs on the project routes', async () => {
    const { client, urls } = clientCapturing()
    await client.renderDoc('demo', 'docs/a.md')
    expect(urls[0]).toBe('/api/render/demo/docs/a.md')
  })
})
