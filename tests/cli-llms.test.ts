import { describe, it, expect } from 'vitest'
import { formatLlmsTxt, type LlmsDoc } from '../src/cli/llms.js'

describe('formatLlmsTxt', () => {
  it('emits the llmstxt.org schema: H1, blockquote summary, two H2 sections', () => {
    const keyDocs: LlmsDoc[] = [
      { title: 'Install', url: '/docs/install/', description: 'How to install.' },
    ]
    const allDocs: LlmsDoc[] = [
      { title: 'Install', url: '/docs/install/', description: 'How to install.' },
      { title: 'API', url: '/docs/api/', description: 'API reference.' },
    ]
    const out = formatLlmsTxt({
      name: 'My Project',
      summary: 'A delightful docs site.',
      keyDocs,
      allDocs,
      baseUrl: 'https://example.com',
    })
    expect(out).toBe(
      '# My Project\n' +
        '\n' +
        '> A delightful docs site.\n' +
        '\n' +
        '## Key documentation\n' +
        '\n' +
        '- [Install](https://example.com/docs/install/): How to install.\n' +
        '\n' +
        '## Full docs\n' +
        '\n' +
        '- [API](https://example.com/docs/api/): API reference.\n',
    )
  })

  it('excludes keyDocs from the Full docs section (no duplication)', () => {
    const doc: LlmsDoc = { title: 'Install', url: '/docs/install/' }
    const out = formatLlmsTxt({
      name: 'Docs',
      summary: 'S',
      keyDocs: [doc],
      allDocs: [doc, { title: 'Guide', url: '/docs/guide/' }],
      baseUrl: 'https://example.com',
    })
    // Install appears once (in Key documentation), Guide once (in Full docs).
    const installCount = (out.match(/\(https:\/\/example\.com\/docs\/install\/\)/g) ?? []).length
    expect(installCount).toBe(1)
    expect(out).toContain('## Key documentation')
    expect(out).toContain('- [Install](https://example.com/docs/install/)\n')
    expect(out).toContain('- [Guide](https://example.com/docs/guide/)\n')
  })

  it('omits the ": description" suffix when a doc has no description', () => {
    const out = formatLlmsTxt({
      name: 'Docs',
      summary: 'S',
      keyDocs: [],
      allDocs: [{ title: 'Guide', url: '/docs/guide/' }],
      baseUrl: 'https://example.com',
    })
    expect(out).toContain('- [Guide](https://example.com/docs/guide/)\n')
    expect(out).not.toContain('/docs/guide/):')
  })

  it('normalizes a bare-hostname baseUrl and avoids double slashes', () => {
    const out = formatLlmsTxt({
      name: 'Docs',
      summary: 'S',
      keyDocs: [],
      allDocs: [{ title: 'Home', url: '/' }],
      baseUrl: 'example.com/',
    })
    expect(out).toContain('- [Home](https://example.com/)\n')
    expect(out).not.toContain('https://example.com//')
  })

  it('omits the Key documentation section when there are no keyDocs', () => {
    const out = formatLlmsTxt({
      name: 'Docs',
      summary: 'S',
      keyDocs: [],
      allDocs: [{ title: 'Home', url: '/' }],
      baseUrl: 'https://example.com',
    })
    expect(out).not.toContain('## Key documentation')
    expect(out).toContain('## Full docs')
  })

  it('omits the Full docs section when every doc is a keyDoc', () => {
    const doc: LlmsDoc = { title: 'Home', url: '/' }
    const out = formatLlmsTxt({
      name: 'Docs',
      summary: 'S',
      keyDocs: [doc],
      allDocs: [doc],
      baseUrl: 'https://example.com',
    })
    expect(out).toContain('## Key documentation')
    expect(out).not.toContain('## Full docs')
  })
})
