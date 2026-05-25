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
  name: 'argus',
  domain: 'argus.io',
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
    summary: 'Argus is an OpenTelemetry-native observability layer for AI agents.',
    keyDocs: ['README.md', 'docs/quickstart.md', 'docs/api.md'],
  },
  seo: {
    ogImage: './brand/og.png',
    twitterHandle: '@arguslabs',
  },
  editOnGitHub: {
    repo: 'arguslabs/argus',
    branch: 'main',
    rootPath: '',
  },
}

describe('defineSite', () => {
  it('returns the config object unchanged (identity)', () => {
    expect(defineSite(VALID_CONFIG)).toEqual(VALID_CONFIG)
  })

  it('rejects configs missing required fields at compile time', () => {
    // @ts-expect-error — missing required `domain` (and the rest)
    defineSite({ name: 'argus' })
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
    await mkdir(path.join(tmpDir, 'argus'), { recursive: true })
    const result = await loadSiteConfig(path.join(tmpDir, 'argus'))
    expect(result).toBeNull()
  })

  it('returns the parsed SiteConfig for a valid .vibedocs.config.ts (real-world import)', async () => {
    // Mirrors what a real project writes: `import { defineSite } from 'vibedocs/config'`.
    // The loader must resolve that import to the in-process defineSite shim.
    const projectDir = path.join(tmpDir, 'argus')
    await mkdir(projectDir, { recursive: true })
    const source = `
      import { defineSite } from 'vibedocs/config'
      export default defineSite({
        name: 'argus',
        domain: 'argus.io',
        description: 'observability',
        theme: { tokens: { primary: '#39ff14' } },
        llms: { summary: 'argus is obs', keyDocs: ['README.md'] },
      })
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')
    const result = await loadSiteConfig(projectDir)
    expect(result).not.toBeNull()
    expect(result?.name).toBe('argus')
    expect(result?.domain).toBe('argus.io')
    expect(result?.theme.tokens.primary).toBe('#39ff14')
    expect(result?.llms.keyDocs).toEqual(['README.md'])
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

  it('throws VibedocsError(invalid) when the config file has a syntax error', async () => {
    const projectDir = path.join(tmpDir, 'syntax-broken')
    await mkdir(projectDir, { recursive: true })
    const source = `export default { name: 'argus', this is not valid ts`
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
        name: 'argus',
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

  it('throws VibedocsError(invalid) with a clear message when a required field is missing', async () => {
    const projectDir = path.join(tmpDir, 'broken')
    await mkdir(projectDir, { recursive: true })
    // Missing `domain` (required).
    const source = `
      export default {
        name: 'argus',
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
})
