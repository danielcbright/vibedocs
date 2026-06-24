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
import vm from 'vm'
import { createRequire } from 'module'
import { access } from 'fs/promises'
import * as esbuild from 'esbuild'
import { VibedocsError } from './errors.js'
import type { SiteConfig } from './shared/site-config-types.js'

export type { SiteConfig, HydrationPolicy } from './shared/site-config-types.js'

const CONFIG_FILENAME = '.vibedocs.config.ts'

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// esbuild plugin that resolves `vibedocs/config` to a virtual module exporting
// an identity `defineSite`. This lets user configs
// `import { defineSite } from 'vibedocs/config'` without vibedocs being
// installed as a runtime dep in their project.
//
// The filter is exactly `vibedocs/config` (not a bare `vibedocs`) so a future
// legitimate `import { x } from 'vibedocs'` isn't silently routed here.
const vibedocsConfigShimPlugin: esbuild.Plugin = {
  name: 'vibedocs-config-shim',
  setup(build) {
    build.onResolve({ filter: /^vibedocs\/config$/ }, (args) => ({
      path: args.path,
      namespace: 'vibedocs-shim',
    }))
    // Add new public helpers here when SiteConfig grows them (e.g. defineTheme).
    // The shim only exports what's listed — a user importing an un-shimmed name
    // would otherwise silently get `undefined`.
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
      // Bundle to CJS, not ESM. We evaluate the result in a fresh vm context
      // (see below) instead of dynamic-import. A dynamic `import()` of a temp
      // file or data: URL registers a permanent entry in Node's ESM loader
      // cache for the process lifetime — one entry leaked per config edit once
      // the chokidar watcher re-loads on each save (#62). CJS-in-vm leaves no
      // such entry: each evaluation is garbage-collected like any object.
      format: 'cjs',
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

  try {
    return evaluateBundledConfig(bundled, configPath)
  } catch (err) {
    if (err instanceof VibedocsError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new VibedocsError(
      'invalid',
      `Failed to evaluate ${path.basename(configPath)}: ${msg}`,
      { cause: err },
    )
  }
}

// Run the esbuild-bundled CommonJS module in a fresh vm context. The bundle is
// self-contained (the shim resolves `vibedocs/config` at build time), so a
// `require` is wired only for resilience — it points at the config file's own
// directory. `filename`/`dirname` use the real config path so any error stack
// is reported against a sensible location. Returns `module.exports.default`.
function evaluateBundledConfig(bundled: string, configPath: string): unknown {
  const module = { exports: {} as Record<string, unknown> }
  const require = createRequire(configPath)
  const wrapper = new vm.Script(
    `(function (exports, require, module, __filename, __dirname) {\n${bundled}\n})`,
    { filename: configPath },
  )
  const fn = wrapper.runInThisContext()
  fn(module.exports, require, module, configPath, path.dirname(configPath))
  return module.exports.default
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

// A required field can fail two distinct ways, and the message must say which:
//   - the field is absent (undefined)          → "missing required field: X"
//   - the field is present but the wrong type   → "invalid field: X (expected …, got …)"
// Conflating them ("missing required field: X (got number)") is internally
// contradictory — the field clearly isn't missing if we can describe its type.
function requiredFieldMessage(
  fieldPath: string,
  value: unknown,
  expected: string,
): string {
  return value === undefined
    ? `missing required field: ${fieldPath}`
    : `invalid field: ${fieldPath} (expected ${expected}, got ${describe(value)})`
}

function requireString(filename: string, value: unknown, fieldPath: string): string {
  if (typeof value !== 'string') {
    fail(filename, requiredFieldMessage(fieldPath, value, 'string'))
  }
  return value as string
}

function requireObject(
  filename: string,
  value: unknown,
  fieldPath: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(filename, requiredFieldMessage(fieldPath, value, 'object'))
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

  if (obj.hydration !== undefined) {
    if (obj.hydration !== 'full' && obj.hydration !== 'minimal') {
      fail(
        filename,
        `invalid field: hydration (expected "full" or "minimal", got ${describe(obj.hydration)}${typeof obj.hydration === 'string' ? ` "${obj.hydration}"` : ''})`,
      )
    }
    result.hydration = obj.hydration
  }

  return result
}
