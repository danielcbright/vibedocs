import { describe, it, expect } from 'vitest'
import {
  rehypeRewriteUrls,
  buildPageUrl,
  type RewriteOptions,
} from '../src/url-rewriter.js'
import { createReferenceCollector } from '../src/reference-collector.js'

// Direct unit tests for the URL Rewriter seam (issue #100).
//
// Drives `rehypeRewriteUrls` by constructing a minimal hast tree and calling
// the plugin function directly — no `unified()` pipeline, no
// `createMarkdownProcessor`. The interface under test is:
//   rehypeRewriteUrls(opts) -> (tree) => void   // mutates href/src in place
//
// Mode is the primary variable: every URL category is asserted in both
// 'live' and 'build'. The mapping rules live in `src/url-rewriter.ts` jsdoc.

// ---------- hast tree builders ----------

interface HastElement {
  type: 'element'
  tagName: string
  properties: Record<string, unknown>
  children: unknown[]
}

interface HastRoot {
  type: 'root'
  children: HastElement[]
}

function anchorTree(href: string): HastRoot {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'a',
        properties: { href },
        children: [],
      },
    ],
  }
}

function imageTree(src: string): HastRoot {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'img',
        properties: { src },
        children: [],
      },
    ],
  }
}

function rewrite(tree: HastRoot, opts: RewriteOptions): HastRoot {
  // The rehype plugin returns a transformer function. Apply it directly.
  const transformer = rehypeRewriteUrls(opts)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformer(tree as any)
  return tree
}

function hrefOf(tree: HastRoot): unknown {
  return tree.children[0]!.properties.href
}

function srcOf(tree: HastRoot): unknown {
  return tree.children[0]!.properties.src
}

// ---------- tests ----------

describe('rehypeRewriteUrls — relative URLs (./foo.png)', () => {
  it('live mode: rewrites <img> relative src to /api/file/<project>/<resolved>', () => {
    const tree = rewrite(imageTree('./foo.png'), {
      mode: 'live',
      projectName: 'myproj',
      currentDocPath: 'docs/guide.md',
    })
    expect(srcOf(tree)).toBe('/api/file/myproj/docs/foo.png')
  })

  it('build mode: rewrites <img> relative src to a relative path under dist/', () => {
    // From docs/guide.md (page URL /docs/guide/), the resolved asset
    // docs/foo.png lives at /docs/foo.png. The relative path from
    // /docs/guide/ back to /docs/foo.png is ../foo.png.
    const tree = rewrite(imageTree('./foo.png'), {
      mode: 'build',
      projectName: 'myproj',
      currentDocPath: 'docs/guide.md',
    })
    expect(srcOf(tree)).toBe('../foo.png')
  })

  it('build mode: rewrites <a> href to a non-markdown relative asset (passes through asset rewriter)', () => {
    // Non-markdown <a> hrefs are treated as assets in build mode.
    const tree = rewrite(anchorTree('./report.pdf'), {
      mode: 'build',
      projectName: 'p',
      currentDocPath: 'docs/guide.md',
    })
    // From /docs/guide/ to /docs/report.pdf → ../report.pdf
    expect(hrefOf(tree)).toBe('../report.pdf')
  })

  it('live mode: leaves non-markdown <a> hrefs alone (only <img> assets are rewritten live)', () => {
    // In live mode, only markdown links and image srcs get special treatment.
    // A relative non-markdown <a> href passes through untouched.
    const tree = rewrite(anchorTree('./report.pdf'), {
      mode: 'live',
      projectName: 'p',
      currentDocPath: 'docs/guide.md',
    })
    expect(hrefOf(tree)).toBe('./report.pdf')
  })
})

describe('rehypeRewriteUrls — absolute-root URLs (/foo.png)', () => {
  // `path.posix.join(currentDir, '/foo.png')` ignores the leading slash on
  // the second arg and treats the value as relative to currentDir. So
  // `/foo.png` from `docs/guide.md` resolves to `docs/foo.png` — i.e.
  // absolute-root inputs are interpreted as relative to the current doc.
  // Two tests below document this behaviour so a future change is forced
  // to update the spec rather than silently changing the contract.

  it('live mode: <img src="/foo.png"> is treated as relative to the current doc directory', () => {
    const tree = rewrite(imageTree('/foo.png'), {
      mode: 'live',
      projectName: 'p',
      currentDocPath: 'docs/guide.md',
    })
    expect(srcOf(tree)).toBe('/api/file/p/docs/foo.png')
  })

  it('build mode: <img src="/foo.png"> resolves relative to the current doc directory', () => {
    const tree = rewrite(imageTree('/foo.png'), {
      mode: 'build',
      projectName: 'p',
      currentDocPath: 'docs/guide.md',
    })
    // Resolved path docs/foo.png at /docs/foo.png, from page /docs/guide/.
    expect(srcOf(tree)).toBe('../foo.png')
  })
})

describe('rehypeRewriteUrls — hash-only URLs (#section)', () => {
  it.each(['live', 'build'] as const)(
    '%s mode: leaves <a href="#section"> untouched (in-page anchor)',
    (mode) => {
      const tree = rewrite(anchorTree('#install'), {
        mode,
        projectName: 'p',
        currentDocPath: 'docs/guide.md',
      })
      expect(hrefOf(tree)).toBe('#install')
    },
  )
})

describe('rehypeRewriteUrls — external URLs', () => {
  it.each(['live', 'build'] as const)(
    '%s mode: leaves https:// <a href> untouched',
    (mode) => {
      const tree = rewrite(anchorTree('https://example.com/path?q=1#x'), {
        mode,
        projectName: 'p',
        currentDocPath: 'docs/guide.md',
      })
      expect(hrefOf(tree)).toBe('https://example.com/path?q=1#x')
    },
  )

  it.each(['live', 'build'] as const)(
    '%s mode: leaves https:// <img src> untouched',
    (mode) => {
      const tree = rewrite(imageTree('https://example.com/img.png'), {
        mode,
        projectName: 'p',
        currentDocPath: 'docs/guide.md',
      })
      expect(srcOf(tree)).toBe('https://example.com/img.png')
    },
  )

  it.each(['live', 'build'] as const)(
    '%s mode: leaves protocol-relative URLs (//cdn) untouched',
    (mode) => {
      const tree = rewrite(imageTree('//cdn.example.com/img.png'), {
        mode,
        projectName: 'p',
        currentDocPath: 'docs/guide.md',
      })
      expect(srcOf(tree)).toBe('//cdn.example.com/img.png')
    },
  )
})

describe('rehypeRewriteUrls — special URI schemes', () => {
  it.each(['live', 'build'] as const)(
    '%s mode: leaves mailto: hrefs untouched',
    (mode) => {
      const tree = rewrite(anchorTree('mailto:foo@example.com'), {
        mode,
        projectName: 'p',
        currentDocPath: 'docs/guide.md',
      })
      expect(hrefOf(tree)).toBe('mailto:foo@example.com')
    },
  )

  it.each(['live', 'build'] as const)(
    '%s mode: leaves tel: hrefs untouched',
    (mode) => {
      const tree = rewrite(anchorTree('tel:+15551234567'), {
        mode,
        projectName: 'p',
        currentDocPath: 'docs/guide.md',
      })
      expect(hrefOf(tree)).toBe('tel:+15551234567')
    },
  )

  it.each(['live', 'build'] as const)(
    '%s mode: leaves data: <img src> untouched',
    (mode) => {
      const dataUri =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='
      const tree = rewrite(imageTree(dataUri), {
        mode,
        projectName: 'p',
        currentDocPath: 'docs/guide.md',
      })
      expect(srcOf(tree)).toBe(dataUri)
    },
  )
})

describe('rehypeRewriteUrls — markdown-link branch (<a href ending in .md>)', () => {
  it('live mode: leaves ./docs/install.md href alone (SPA hash router handles it)', () => {
    const tree = rewrite(anchorTree('./docs/install.md'), {
      mode: 'live',
      projectName: 'p',
      currentDocPath: 'README.md',
    })
    expect(hrefOf(tree)).toBe('./docs/install.md')
  })

  it('build mode: rewrites ./docs/install.md to a clean URL', () => {
    const tree = rewrite(anchorTree('./docs/install.md'), {
      mode: 'build',
      projectName: 'p',
      currentDocPath: 'README.md',
    })
    // From / to /docs/install/ → ./docs/install/
    expect(hrefOf(tree)).toBe('./docs/install/')
  })

  it('build mode: rewrites a sibling ./README.md to the containing directory URL', () => {
    // From docs/guide.md the relative './README.md' resolves to docs/README.md.
    // buildPageUrl('docs/README.md') === '/docs/' (README folds to its dir).
    // From page /docs/guide/ to /docs/ → ../.
    const tree = rewrite(anchorTree('./README.md'), {
      mode: 'build',
      projectName: 'p',
      currentDocPath: 'docs/guide.md',
    })
    expect(hrefOf(tree)).toBe('../')
  })

  it('build mode: handles .markdown extension the same as .md', () => {
    const tree = rewrite(anchorTree('./notes.markdown'), {
      mode: 'build',
      projectName: 'p',
      currentDocPath: 'README.md',
    })
    expect(hrefOf(tree)).toBe('./notes/')
  })
})

describe('rehypeRewriteUrls — reference collector', () => {
  it('live mode: collector receives a record for each <img> with the resolved path and source doc', () => {
    const collector = createReferenceCollector()
    rewrite(imageTree('./foo.png'), {
      mode: 'live',
      projectName: 'p',
      currentDocPath: 'docs/guide.md',
      collector,
    })
    expect(collector.getRefs()).toEqual([
      { resolvedPath: 'docs/foo.png', sourceDoc: 'docs/guide.md' },
    ])
  })

  it('build mode: collector receives the same record (drives missing-ref detection upstream)', () => {
    const collector = createReferenceCollector()
    rewrite(imageTree('./diagrams/arch.svg'), {
      mode: 'build',
      projectName: 'p',
      currentDocPath: 'README.md',
      collector,
    })
    expect(collector.getRefs()).toEqual([
      { resolvedPath: 'diagrams/arch.svg', sourceDoc: 'README.md' },
    ])
  })

  it('does not record external <img src> on the collector', () => {
    const collector = createReferenceCollector()
    rewrite(imageTree('https://example.com/x.png'), {
      mode: 'live',
      projectName: 'p',
      currentDocPath: 'README.md',
      collector,
    })
    expect(collector.getRefs()).toEqual([])
  })

  it('does not record paths escaping the project root (asset returned null)', () => {
    const collector = createReferenceCollector()
    rewrite(imageTree('../../etc/secret.png'), {
      mode: 'live',
      projectName: 'p',
      currentDocPath: 'docs/guide.md',
      collector,
    })
    expect(collector.getRefs()).toEqual([])
  })
})

describe('rehypeRewriteUrls — query strings and fragments preserved', () => {
  it('live mode: <img src="./foo.png?v=1#anchor"> keeps the suffix on the rewritten URL', () => {
    const tree = rewrite(imageTree('./foo.png?v=1#anchor'), {
      mode: 'live',
      projectName: 'p',
      currentDocPath: 'docs/guide.md',
    })
    expect(srcOf(tree)).toBe('/api/file/p/docs/foo.png?v=1#anchor')
  })

  it('build mode: <a href="./install.md#step-2"> keeps the fragment on the clean URL', () => {
    const tree = rewrite(anchorTree('./install.md#step-2'), {
      mode: 'build',
      projectName: 'p',
      currentDocPath: 'README.md',
    })
    expect(hrefOf(tree)).toBe('./install/#step-2')
  })
})

describe('rehypeRewriteUrls — paths escaping the project root', () => {
  it.each(['live', 'build'] as const)(
    '%s mode: leaves an escaping <img src> unchanged (rewriter returns null)',
    (mode) => {
      const tree = rewrite(imageTree('../../../etc/passwd'), {
        mode,
        projectName: 'p',
        currentDocPath: 'docs/guide.md',
      })
      // Null result from rewriteAssetUrl means properties.src is NOT
      // assigned, so the original value remains.
      expect(srcOf(tree)).toBe('../../../etc/passwd')
    },
  )

  it('build mode: leaves an escaping markdown <a href> unchanged', () => {
    const tree = rewrite(anchorTree('../../../../other-project/README.md'), {
      mode: 'build',
      projectName: 'p',
      currentDocPath: 'docs/guide.md',
    })
    expect(hrefOf(tree)).toBe('../../../../other-project/README.md')
  })
})

describe('buildPageUrl — pure helper', () => {
  it('returns / for the root README.md', () => {
    expect(buildPageUrl('README.md')).toBe('/')
  })

  it('returns / for the root index.md', () => {
    expect(buildPageUrl('index.md')).toBe('/')
  })

  it('folds a folder README into its containing directory URL', () => {
    expect(buildPageUrl('docs/README.md')).toBe('/docs/')
  })

  it('folds a folder index into its containing directory URL', () => {
    expect(buildPageUrl('docs/install/index.markdown')).toBe('/docs/install/')
  })

  it('strips .md and adds a trailing slash for a regular page', () => {
    expect(buildPageUrl('docs/install.md')).toBe('/docs/install/')
  })

  it('strips .markdown the same as .md', () => {
    expect(buildPageUrl('notes.markdown')).toBe('/notes/')
  })
})

describe('rehypeRewriteUrls — non-href/src elements are ignored', () => {
  it('leaves <span> elements untouched (the plugin only rewrites <a>/<img>)', () => {
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          // Use href/src on a non-a/img element to confirm the tagName guard.
          properties: { href: './foo.md', src: './foo.png' },
          children: [],
        },
      ],
    }
    rewrite(tree, {
      mode: 'build',
      projectName: 'p',
      currentDocPath: 'README.md',
    })
    expect(tree.children[0]!.properties.href).toBe('./foo.md')
    expect(tree.children[0]!.properties.src).toBe('./foo.png')
  })
})
