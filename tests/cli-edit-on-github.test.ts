import { describe, it, expect } from 'vitest'
import { resolveEditUrl } from '../src/cli/edit-on-github.js'

describe('resolveEditUrl — pure URL composition (#55)', () => {
  it('composes repo/branch/rootPath/docPath into a GitHub edit URL', () => {
    const url = resolveEditUrl(
      { repo: 'your-org/your-project', branch: 'main', rootPath: 'docs' },
      'install.md',
    )
    expect(url).toBe('https://github.com/your-org/your-project/edit/main/docs/install.md')
  })

  it('handles a non-main branch', () => {
    const url = resolveEditUrl(
      { repo: 'acme/site', branch: 'gh-pages', rootPath: 'content' },
      'guide.md',
    )
    expect(url).toBe('https://github.com/acme/site/edit/gh-pages/content/guide.md')
  })

  it('omits the rootPath segment when rootPath is empty', () => {
    const url = resolveEditUrl(
      { repo: 'acme/site', branch: 'main', rootPath: '' },
      'README.md',
    )
    expect(url).toBe('https://github.com/acme/site/edit/main/README.md')
  })

  it('treats a "." rootPath as the repo root (no extra segment)', () => {
    const url = resolveEditUrl(
      { repo: 'acme/site', branch: 'main', rootPath: '.' },
      'README.md',
    )
    expect(url).toBe('https://github.com/acme/site/edit/main/README.md')
  })

  it('joins nested docPaths under rootPath without double slashes', () => {
    const url = resolveEditUrl(
      { repo: 'acme/site', branch: 'main', rootPath: 'docs' },
      'guides/getting-started.md',
    )
    expect(url).toBe('https://github.com/acme/site/edit/main/docs/guides/getting-started.md')
  })

  it('trims stray surrounding slashes on repo and rootPath', () => {
    const url = resolveEditUrl(
      { repo: '/acme/site/', branch: 'main', rootPath: '/docs/' },
      'install.md',
    )
    expect(url).toBe('https://github.com/acme/site/edit/main/docs/install.md')
  })
})
