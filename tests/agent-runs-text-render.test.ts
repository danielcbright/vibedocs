import { describe, it, expect } from 'vitest'
import { createTextRenderer, enrichRecords } from '../src/agent-runs/text-render.js'
import type { EventRecord } from '../src/shared/agent-run-types.js'

const renderer = createTextRenderer()

describe('agent text rendering', () => {
  it('renders headings, lists, bold and inline code as markdown', async () => {
    const html = await renderer.render('## Plan\n\n- read `router.ts`\n- **add** the route')
    expect(html).toContain('<h2')
    expect(html).toContain('<li>')
    expect(html).toContain('<strong>')
    expect(html).toContain('<code>')
    expect(html).not.toContain('## Plan')   // not left as raw text
  })

  it('highlights fenced code through shiki', async () => {
    const html = await renderer.render('```ts\nconst x: number = 1\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('shiki')
  })

  it('renders GFM tables', async () => {
    const html = await renderer.render('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table')
  })

  // Agent text is untrusted — this is the security boundary.
  it('strips script tags and event-handler attributes', async () => {
    const html = await renderer.render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  it('strips javascript: hrefs', async () => {
    const html = await renderer.render('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
  })

  it('does not emit heading anchors, so two events cannot collide on one id', async () => {
    const a = await renderer.render('## Summary')
    const b = await renderer.render('## Summary')
    expect(a).toBe(b)
    expect(a).not.toContain('heading-anchor')
    // Either no id at all, or a clobber-prefixed one — never a bare `id="summary"`.
    expect(a).not.toMatch(/id="summary"/)
  })

  it('does not rewrite relative links into project asset URLs', async () => {
    const html = await renderer.render('[x](./notes.md) and ![y](./img.png)')
    expect(html).not.toContain('/api/file/')
  })

  it('returns empty string for empty input without touching the pipeline', async () => {
    expect(await renderer.render('')).toBe('')
    expect(await renderer.render('   ')).toBe('')
  })

  it('caches by content so repeated text renders once', async () => {
    const fresh = createTextRenderer()
    await fresh.render('# same')
    await fresh.render('# same')
    await fresh.render('# other')
    expect(fresh.size).toBe(2)
  })

  it('bounds the cache', async () => {
    const small = createTextRenderer({ maxEntries: 2 })
    for (const t of ['# a', '# b', '# c']) await small.render(t)
    expect(small.size).toBeLessThanOrEqual(2)
  })
})

describe('enrichRecords', () => {
  const rec = (kind: string, text?: string): EventRecord => ({
    op: 'append',
    event: { seq: 1, ts: 1, kind: kind as any, ...(text !== undefined ? { text } : {}) },
  })

  it('attaches textHtml to markdown-bearing kinds only', async () => {
    const out = await enrichRecords(
      [rec('assistant', '## a'), rec('result', '**b**'), rec('user', 'plain'), rec('thinking', '## not markdown here'), rec('other')],
      renderer,
    )
    const events = out.map((r) => (r.op === 'append' ? r.event : null))
    expect(events[0]!.textHtml).toContain('<h2')
    expect(events[1]!.textHtml).toContain('<strong>')
    expect(events[2]!.textHtml).toContain('plain')      // user briefs are markdown too
    expect(events[3]!.textHtml).toBeUndefined()          // thinking renders as plain text
    expect(events[4]!.textHtml).toBeUndefined()
  })

  it('leaves patch records untouched', async () => {
    const patch: EventRecord = { op: 'patch', seq: 1, patch: { tool: { status: 'success' } as any } }
    expect(await enrichRecords([patch], renderer)).toEqual([patch])
  })

  it('never persists textHtml back onto the source record', async () => {
    const source = rec('assistant', '## a')
    await enrichRecords([source], renderer)
    expect((source as any).event.textHtml).toBeUndefined()
  })
})
