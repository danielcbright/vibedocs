import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import path from 'path'
import os from 'os'
import {
  defineSite,
  loadSiteConfig,
  type SiteConfig,
} from '../src/site-config.js'
import { VibedocsError } from '../src/errors.js'

const VALID_CONFIG: SiteConfig = {
  name: 'demo',
  domain: 'example.com',
  description: 'Drop-in observability for AI agents',
  theme: {
    tokens: {
      primary: '#39ff14',
      background: '#0a0e0a',
    },
    logo: './brand/logo.svg',
    favicon: './brand/favicon.ico',
    css: './brand/extras.css',
  },
  nav: {
    sections: [
      { label: 'Getting Started', items: ['README.md', 'docs/install.md'] },
      { label: 'Reference', items: ['docs/api.md', 'docs/cli.md'] },
    ],
  },
  llms: {
    summary: 'Demo is an OpenTelemetry-native observability layer for AI agents.',
    keyDocs: ['README.md', 'docs/quickstart.md', 'docs/api.md'],
  },
  seo: {
    ogImage: './brand/og.png',
    twitterHandle: '@demolabs',
  },
  editOnGitHub: {
    repo: 'demolabs/demo',
    branch: 'main',
    rootPath: '',
  },
}

describe('defineSite', () => {
  it('returns the same object reference unchanged (identity)', () => {
    // Reference identity (toBe), not structural equality (toEqual): defineSite
    // is an identity function, it must return the exact object passed in.
    expect(defineSite(VALID_CONFIG)).toBe(VALID_CONFIG)
  })

  it('rejects configs missing required fields at compile time', () => {
    // @ts-expect-error — missing required `domain` (and the rest)
    defineSite({ name: 'demo' })
  })
})

describe('loadSiteConfig', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-site-config-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns null when the project has no .vibedocs.config.ts', async () => {
    await mkdir(path.join(tmpDir, 'demo'), { recursive: true })
    const result = await loadSiteConfig(path.join(tmpDir, 'demo'))
    expect(result).toBeNull()
  })

  it('returns the parsed SiteConfig for a valid .vibedocs.config.ts (real-world import)', async () => {
    // Mirrors what a real project writes: `import { defineSite } from 'vibedocs/config'`.
    // The loader must resolve that import to the in-process defineSite shim.
    const projectDir = path.join(tmpDir, 'demo')
    await mkdir(projectDir, { recursive: true })
    const source = `
      import { defineSite } from 'vibedocs/config'
      export default defineSite({
        name: 'demo',
        domain: 'example.com',
        description: 'observability',
        theme: { tokens: { primary: '#39ff14' } },
        llms: { summary: 'demo is obs', keyDocs: ['README.md'] },
      })
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    const result = await loadSiteConfig(projectDir)
    expect(result).not.toBeNull()
    expect(result?.name).toBe('demo')
    expect(result?.domain).toBe('example.com')
    expect(result?.theme.tokens.primary).toBe('#39ff14')
    expect(result?.llms.keyDocs).toEqual(['README.md'])
  })

  it('does not route a bare `vibedocs` import to the config shim', async () => {
    // The shim must only intercept `vibedocs/config`. A bare `import … from
    // 'vibedocs'` should be left to normal resolution (and here fail, since the
    // package isn't a real dep of the throwaway test project) — never silently
    // resolved to the defineSite shim.
    const projectDir = path.join(tmpDir, 'bare-import')
    await mkdir(projectDir, { recursive: true })
    const source = `
      import { defineSite } from 'vibedocs'
      export default defineSite({
        name: 'demo',
        domain: 'example.com',
        description: 'd',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
      })
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    await expect(loadSiteConfig(projectDir)).rejects.toThrow(VibedocsError)
  })

  it('returns the parsed SiteConfig when defineSite is not used (plain object default export)', async () => {
    const projectDir = path.join(tmpDir, 'plain')
    await mkdir(projectDir, { recursive: true })
    const source = `
      export default {
        name: 'plain',
        domain: 'plain.example',
        description: 'no helper',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    const result = await loadSiteConfig(projectDir)
    expect(result?.name).toBe('plain')
  })

  it('re-evaluates the same config path on each load (no stale ESM module cache)', async () => {
    // Regression guard for the ESM module-cache leak (#62): the loader must not
    // depend on Node's ESM URL cache. Loading the same path twice — with the
    // file edited in between — must return the fresh content, and repeated
    // loads must not accumulate. We load the identical path many times to
    // exercise the no-leak path.
    const projectDir = path.join(tmpDir, 'reload')
    await mkdir(projectDir, { recursive: true })
    const configPath = path.join(projectDir, '.vibedocs.config.ts')
    const write = async (domain: string) =>
      writeFile(
        configPath,
        `export default {
          name: 'demo', domain: '${domain}', description: 'd',
          theme: { tokens: {} }, llms: { summary: 's', keyDocs: [] },
        }`,
        'utf8',
      )

    await write('v1.example.com')
    const first = await loadSiteConfig(projectDir)
    expect(first?.domain).toBe('v1.example.com')

    await write('v2.example.com')
    const second = await loadSiteConfig(projectDir)
    expect(second?.domain).toBe('v2.example.com')

    // Hammer the same path; every call must succeed and return the latest.
    for (let i = 0; i < 25; i++) {
      const r = await loadSiteConfig(projectDir)
      expect(r?.domain).toBe('v2.example.com')
    }
  })

  it('surfaces a runtime error thrown while evaluating the config as VibedocsError(invalid)', async () => {
    const projectDir = path.join(tmpDir, 'throws-at-eval')
    await mkdir(projectDir, { recursive: true })
    const source = `throw new Error('boom at module eval'); export default {}`
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('invalid')
      expect((err as VibedocsError).message).toMatch(/Failed to evaluate/)
    }
  })

  it('throws VibedocsError(invalid) when the config file has a syntax error', async () => {
    const projectDir = path.join(tmpDir, 'syntax-broken')
    await mkdir(projectDir, { recursive: true })
    const source = `export default { name: 'demo', this is not valid ts`
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('invalid')
      expect((err as VibedocsError).message).toMatch(/\.vibedocs\.config\.ts/)
    }
  })

  it('throws VibedocsError(invalid) when a field has the wrong type (domain as number)', async () => {
    const projectDir = path.join(tmpDir, 'wrong-type')
    await mkdir(projectDir, { recursive: true })
    const source = `
      export default {
        name: 'demo',
        domain: 42,
        description: 'wrong type',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('invalid')
      expect((err as VibedocsError).message).toMatch(/domain/)
      expect((err as VibedocsError).message).toMatch(/string/)
    }
  })

  it('says "invalid field" (not "missing required field") when a string field is present but wrong-typed', async () => {
    const projectDir = path.join(tmpDir, 'present-wrong-type-string')
    await mkdir(projectDir, { recursive: true })
    const source = `
      export default {
        name: 'demo',
        domain: 42,
        description: 'wrong type',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      const msg = (err as VibedocsError).message
      expect(msg).toMatch(/invalid field: domain/)
      expect(msg).not.toMatch(/missing required field/)
      expect(msg).toMatch(/got number/)
    }
  })

  it('says "missing required field" (not "invalid field") when a string field is absent', async () => {
    const projectDir = path.join(tmpDir, 'absent-string')
    await mkdir(projectDir, { recursive: true })
    const source = `
      export default {
        name: 'demo',
        description: 'no domain',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      const msg = (err as VibedocsError).message
      expect(msg).toMatch(/missing required field: domain/)
      expect(msg).not.toMatch(/invalid field/)
    }
  })

  it('says "invalid field" (not "missing required field") when an object field is present but wrong-typed', async () => {
    const projectDir = path.join(tmpDir, 'present-wrong-type-object')
    await mkdir(projectDir, { recursive: true })
    const source = `
      export default {
        name: 'demo',
        domain: 'example.com',
        description: 'theme is a number',
        theme: 42,
        llms: { summary: 's', keyDocs: [] },
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      const msg = (err as VibedocsError).message
      expect(msg).toMatch(/invalid field: theme/)
      expect(msg).not.toMatch(/missing required field/)
      expect(msg).toMatch(/got number/)
    }
  })

  it('says "invalid field" when an object field is present but is an array', async () => {
    const projectDir = path.join(tmpDir, 'object-is-array')
    await mkdir(projectDir, { recursive: true })
    const source = `
      export default {
        name: 'demo',
        domain: 'example.com',
        description: 'theme is an array',
        theme: [],
        llms: { summary: 's', keyDocs: [] },
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      const msg = (err as VibedocsError).message
      expect(msg).toMatch(/invalid field: theme/)
      expect(msg).not.toMatch(/missing required field/)
      expect(msg).toMatch(/got array/)
    }
  })

  it('throws VibedocsError(invalid) with a clear message when a required field is missing', async () => {
    const projectDir = path.join(tmpDir, 'broken')
    await mkdir(projectDir, { recursive: true })
    // Missing `domain` (required).
    const source = `
      export default {
        name: 'demo',
        description: 'no domain',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('invalid')
      expect((err as VibedocsError).message).toMatch(/domain/)
    }
  })

  it('reports the indexed path nav.sections[i].label when a section is malformed', async () => {
    const projectDir = path.join(tmpDir, 'bad-nav-section')
    await mkdir(projectDir, { recursive: true })
    const source = `
      export default {
        name: 'demo',
        domain: 'example.com',
        description: 'd',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
        nav: { sections: [
          { label: 'ok', items: [] },
          { label: 99, items: [] },
        ] },
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      const msg = (err as VibedocsError).message
      expect(msg).toMatch(/nav\.sections\[1\]\.label/)
      expect(msg).toMatch(/invalid field/)
    }
  })

  it('rejects a non-string value inside theme.tokens with the keyed path', async () => {
    const projectDir = path.join(tmpDir, 'bad-token')
    await mkdir(projectDir, { recursive: true })
    const source = `
      export default {
        name: 'demo',
        domain: 'example.com',
        description: 'd',
        theme: { tokens: { primary: '#fff', accent: 42 } },
        llms: { summary: 's', keyDocs: [] },
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      const msg = (err as VibedocsError).message
      expect(msg).toMatch(/theme\.tokens\.accent/)
      expect(msg).toMatch(/got number/)
    }
  })

  it('reports "no default export" when the config exports null', async () => {
    const projectDir = path.join(tmpDir, 'null-default')
    await mkdir(projectDir, { recursive: true })
    const source = `export default null`
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).message).toMatch(/no default export/)
    }
  })

  it('reports "no default export" when the config has no default export at all', async () => {
    const projectDir = path.join(tmpDir, 'no-default')
    await mkdir(projectDir, { recursive: true })
    // Only a named export — module.default is undefined.
    const source = `export const config = { name: 'x' }`
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).message).toMatch(/no default export/)
    }
  })

  it('round-trips a full editOnGitHub block through the validator', async () => {
    const projectDir = path.join(tmpDir, 'edit-on-github')
    await mkdir(projectDir, { recursive: true })
    const source = `
      export default {
        name: 'demo',
        domain: 'example.com',
        description: 'd',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
        editOnGitHub: { repo: 'acme/demo', branch: 'main', rootPath: 'docs' },
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    const result = await loadSiteConfig(projectDir)
    expect(result?.editOnGitHub).toEqual({
      repo: 'acme/demo',
      branch: 'main',
      rootPath: 'docs',
    })
  })

  it('accepts hydration: "full" and "minimal"; rejects other strings (#76)', async () => {
    for (const value of ['full', 'minimal'] as const) {
      const projectDir = path.join(tmpDir, `hydration-${value}`)
      await mkdir(projectDir, { recursive: true })
      const source = `
        export default {
          name: 'h',
          domain: 'h.example',
          description: 'd',
          theme: { tokens: {} },
          llms: { summary: 's', keyDocs: [] },
          hydration: '${value}',
        }
      `
      await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
      const result = await loadSiteConfig(projectDir)
      expect(result?.hydration).toBe(value)
    }

    // And reject something else with a clear field-path error.
    const projectDir = path.join(tmpDir, 'hydration-bad')
    await mkdir(projectDir, { recursive: true })
    const source = `
      export default {
        name: 'h',
        domain: 'h.example',
        description: 'd',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
        hydration: 'progressive',
      }
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    try {
      await loadSiteConfig(projectDir)
      throw new Error('expected loadSiteConfig to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('invalid')
      expect((err as VibedocsError).message).toMatch(/hydration/)
    }
  })
})
