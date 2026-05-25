// Per-project site config loader. Pure module — no Hono coupling.
//
// Each documented project may ship a `.vibedocs.config.ts` at its root that
// exports (default) a `SiteConfig`. This module provides:
//   - `SiteConfig`     the canonical shape (single source of truth)
//   - `defineSite`     identity-typed helper so consumers get autocomplete
//   - `loadSiteConfig` async loader that transpiles the .ts via esbuild and
//                      validates the resulting object before returning it
//
// Config files are user-controlled, so we validate at runtime (TypeScript
// types vanish at the boundary). Failures throw VibedocsError('invalid', ...)
// with a message that names the offending field.

import path from 'path'
import os from 'os'
import { access, mkdtemp, writeFile, rm } from 'fs/promises'
import { pathToFileURL } from 'url'
import * as esbuild from 'esbuild'
import { VibedocsError } from './errors.js'

const CONFIG_FILENAME = '.vibedocs.config.ts'

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// esbuild plugin that resolves `vibedocs/config` (and bare `vibedocs`) to a
// virtual module exporting an identity `defineSite`. This lets user configs
// `import { defineSite } from 'vibedocs/config'` without vibedocs being
// installed as a runtime dep in their project.
const vibedocsConfigShimPlugin: esbuild.Plugin = {
  name: 'vibedocs-config-shim',
  setup(build) {
    build.onResolve({ filter: /^vibedocs(\/config)?$/ }, (args) => ({
      path: args.path,
      namespace: 'vibedocs-shim',
    }))
    build.onLoad({ filter: /.*/, namespace: 'vibedocs-shim' }, () => ({
      contents: 'export function defineSite(c) { return c }\n',
      loader: 'js',
    }))
  },
}

async function transpileAndImport(configPath: string): Promise<unknown> {
  let bundled: string
  try {
    const result = await esbuild.build({
      entryPoints: [configPath],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      logLevel: 'silent',
      plugins: [vibedocsConfigShimPlugin],
    })
    bundled = result.outputFiles[0]!.text
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new VibedocsError(
      'invalid',
      `Failed to parse ${path.basename(configPath)}: ${msg}`,
      { cause: err },
    )
  }

  // Write the bundled ESM to a temp .mjs file and dynamic-import it. Using a
  // file (not a data: URL) keeps source-map and stack traces sensible if the
  // user config throws at evaluation time.
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-config-'))
  const tmpFile = path.join(tmp, 'config.mjs')
  try {
    await writeFile(tmpFile, bundled, 'utf8')
    const mod = await import(pathToFileURL(tmpFile).href)
    return mod.default
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new VibedocsError(
      'invalid',
      `Failed to evaluate ${path.basename(configPath)}: ${msg}`,
      { cause: err },
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

export interface SiteConfig {
  name: string
  domain: string
  description: string
  theme: {
    tokens: Record<string, string>
    logo?: string
    favicon?: string
    css?: string
  }
  nav?: {
    sections: Array<{ label: string; items: string[] }>
  }
  llms: {
    summary: string
    keyDocs: string[]
  }
  seo?: {
    ogImage?: string
    twitterHandle?: string
  }
  editOnGitHub?: {
    repo: string
    branch: string
    rootPath: string
  }
}

/**
 * Identity-typed helper. Consumers use `export default defineSite({...})` in
 * their `.vibedocs.config.ts` to get autocomplete and compile-time errors.
 */
export function defineSite(config: SiteConfig): SiteConfig {
  return config
}

export async function loadSiteConfig(projectPath: string): Promise<SiteConfig | null> {
  const configPath = path.join(projectPath, CONFIG_FILENAME)
  if (!(await fileExists(configPath))) return null
  const loaded = await transpileAndImport(configPath)
  return validateSiteConfig(loaded, CONFIG_FILENAME)
}

// ── Runtime validation ──────────────────────────────────────────────────────
//
// The config is user-controlled TypeScript: types vanish at the module
// boundary, so we re-check every required field. Errors name the offending
// path (e.g. "theme.tokens") so the user can fix without reading a stack
// trace. Hand-rolled to avoid pulling in a schema lib for ~6 required fields.

function fail(filename: string, msg: string): never {
  throw new VibedocsError('invalid', `${filename}: ${msg}`)
}

function requireString(filename: string, value: unknown, fieldPath: string): string {
  if (typeof value !== 'string') {
    fail(filename, `missing required field: ${fieldPath} (expected string, got ${describe(value)})`)
  }
  return value as string
}

function requireObject(
  filename: string,
  value: unknown,
  fieldPath: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(filename, `missing required field: ${fieldPath} (expected object, got ${describe(value)})`)
  }
  return value as Record<string, unknown>
}

function requireStringArray(filename: string, value: unknown, fieldPath: string): string[] {
  if (!Array.isArray(value) || !value.every((x) => typeof x === 'string')) {
    fail(
      filename,
      `invalid field: ${fieldPath} (expected string[], got ${describe(value)})`,
    )
  }
  return value as string[]
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function validateSiteConfig(raw: unknown, filename: string): SiteConfig {
  if (raw === undefined || raw === null) {
    fail(filename, 'no default export found (expected a SiteConfig object)')
  }
  const obj = requireObject(filename, raw, '<default export>')

  const name = requireString(filename, obj.name, 'name')
  const domain = requireString(filename, obj.domain, 'domain')
  const description = requireString(filename, obj.description, 'description')

  const theme = requireObject(filename, obj.theme, 'theme')
  const tokensRaw = requireObject(filename, theme.tokens, 'theme.tokens')
  for (const [k, v] of Object.entries(tokensRaw)) {
    if (typeof v !== 'string') {
      fail(
        filename,
        `invalid field: theme.tokens.${k} (expected string, got ${describe(v)})`,
      )
    }
  }
  const tokens = tokensRaw as Record<string, string>

  const llms = requireObject(filename, obj.llms, 'llms')
  const llmsSummary = requireString(filename, llms.summary, 'llms.summary')
  const llmsKeyDocs = requireStringArray(filename, llms.keyDocs, 'llms.keyDocs')

  const result: SiteConfig = {
    name,
    domain,
    description,
    theme: {
      tokens,
      ...(theme.logo !== undefined && { logo: requireString(filename, theme.logo, 'theme.logo') }),
      ...(theme.favicon !== undefined && {
        favicon: requireString(filename, theme.favicon, 'theme.favicon'),
      }),
      ...(theme.css !== undefined && { css: requireString(filename, theme.css, 'theme.css') }),
    },
    llms: { summary: llmsSummary, keyDocs: llmsKeyDocs },
  }

  if (obj.nav !== undefined) {
    const nav = requireObject(filename, obj.nav, 'nav')
    if (!Array.isArray(nav.sections)) {
      fail(filename, `invalid field: nav.sections (expected array, got ${describe(nav.sections)})`)
    }
    const sections = nav.sections.map((s, i) => {
      const section = requireObject(filename, s, `nav.sections[${i}]`)
      return {
        label: requireString(filename, section.label, `nav.sections[${i}].label`),
        items: requireStringArray(filename, section.items, `nav.sections[${i}].items`),
      }
    })
    result.nav = { sections }
  }

  if (obj.seo !== undefined) {
    const seo = requireObject(filename, obj.seo, 'seo')
    result.seo = {
      ...(seo.ogImage !== undefined && {
        ogImage: requireString(filename, seo.ogImage, 'seo.ogImage'),
      }),
      ...(seo.twitterHandle !== undefined && {
        twitterHandle: requireString(filename, seo.twitterHandle, 'seo.twitterHandle'),
      }),
    }
  }

  if (obj.editOnGitHub !== undefined) {
    const e = requireObject(filename, obj.editOnGitHub, 'editOnGitHub')
    result.editOnGitHub = {
      repo: requireString(filename, e.repo, 'editOnGitHub.repo'),
      branch: requireString(filename, e.branch, 'editOnGitHub.branch'),
      rootPath: requireString(filename, e.rootPath, 'editOnGitHub.rootPath'),
    }
  }

  return result
}
