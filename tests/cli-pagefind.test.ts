import { describe, it, expect } from 'vitest'
import {
  renderPagefindHeadTags,
  renderPagefindUiTags,
  resolveSearchEnabled,
} from '../src/cli/pagefind.js'

describe('renderPagefindHeadTags', () => {
  it('emits the Pagefind UI stylesheet link', () => {
    const tags = renderPagefindHeadTags()
    expect(tags).toContain('<link rel="stylesheet" href="/pagefind/pagefind-ui.css">')
  })
})

describe('renderPagefindUiTags', () => {
  it('emits the search container, the UI script, and an init that mounts on it', () => {
    const html = renderPagefindUiTags()
    // A mount point with a stable id the init script targets.
    expect(html).toMatch(/<div[^>]*id="vd-search"/)
    // Loads the self-hosted Pagefind UI bundle (not the SPA bundle).
    expect(html).toContain('<script src="/pagefind/pagefind-ui.js"></script>')
    // Inits PagefindUI against the mount point.
    expect(html).toContain('new PagefindUI(')
    expect(html).toContain('#vd-search')
  })

  it('does not depend on window.__VIBEDOCS_STATIC or the SPA bundle (works in minimal mode)', () => {
    const html = renderPagefindUiTags()
    expect(html).not.toContain('__VIBEDOCS_STATIC')
    expect(html).not.toContain('type="module"')
  })
})

describe('resolveSearchEnabled', () => {
  it('defaults to true when nothing is configured', () => {
    expect(resolveSearchEnabled(undefined)).toBe(true)
  })

  it('honours an explicit siteConfig.search === false to disable', () => {
    expect(resolveSearchEnabled(false)).toBe(false)
  })

  it('honours an explicit siteConfig.search === true', () => {
    expect(resolveSearchEnabled(true)).toBe(true)
  })
})
