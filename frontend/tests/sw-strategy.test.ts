import { describe, it, expect } from 'vitest'
import { chooseStrategy, cacheName, isStaleCache, type RequestShape } from '@/lib/sw-strategy'

const base = (over: Partial<RequestShape> = {}): RequestShape => ({
  method: 'GET',
  pathname: '/',
  isNavigation: false,
  crossOrigin: false,
  ...over,
})

describe('chooseStrategy', () => {
  it('never caches non-GET requests', () => {
    expect(chooseStrategy(base({ method: 'POST', pathname: '/api/upload/x' }))).toBe('network-only')
  })

  it('never caches cross-origin requests', () => {
    expect(chooseStrategy(base({ crossOrigin: true, pathname: '/assets/x.js' }))).toBe('network-only')
  })

  it('serves hashed /assets/ cache-first (immutable)', () => {
    expect(chooseStrategy(base({ pathname: '/assets/index-abc123.js' }))).toBe('cache-first')
  })

  it('caches rendered docs network-first so they read offline', () => {
    expect(chooseStrategy(base({ pathname: '/api/render/proj/doc.md' }))).toBe('network-first')
    expect(chooseStrategy(base({ pathname: '/api/raw/proj/doc.md' }))).toBe('network-first')
  })

  it('caches the project list network-first for an offline sidebar', () => {
    expect(chooseStrategy(base({ pathname: '/api/projects' }))).toBe('network-first')
    expect(chooseStrategy(base({ pathname: '/api/projects?fileType=markdown' }))).toBe('network-first')
  })

  it('does NOT cache live/dynamic api routes (search, config, ws)', () => {
    expect(chooseStrategy(base({ pathname: '/api/search?q=hi' }))).toBe('network-only')
    expect(chooseStrategy(base({ pathname: '/api/config' }))).toBe('network-only')
  })

  it('serves navigations network-first with a cache fallback', () => {
    expect(chooseStrategy(base({ isNavigation: true, pathname: '/' }))).toBe('network-first')
  })
})

describe('cache versioning', () => {
  it('embeds the version in the cache name', () => {
    expect(cacheName('abc123')).toBe('vibedocs-abc123')
  })

  it('marks every non-matching vibedocs cache stale on activate', () => {
    expect(isStaleCache('vibedocs-old', 'new')).toBe(true)
    expect(isStaleCache('vibedocs-new', 'new')).toBe(false)
    expect(isStaleCache('some-other-app-cache', 'new')).toBe(false) // leave foreign caches alone
  })
})
