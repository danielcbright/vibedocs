import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs build script, no type declarations by design.
import { planPrepare, envForChildNpm } from '../scripts/prepare-plan.mjs'

const PKG = '/repo/vibedocs'

describe('planPrepare — prepare lifecycle decision', () => {
  it('skips the frontend build on a local dev self-install', () => {
    const plan = planPrepare({ initCwd: PKG, packageDir: PKG, npmCommand: 'install' })
    expect(plan.buildFrontend).toBe(false)
  })

  it('builds the frontend on a consumer git-dep install', () => {
    const plan = planPrepare({
      initCwd: '/home/someone/their-project',
      packageDir: `/home/someone/their-project/node_modules/vibedocs`,
      npmCommand: 'install',
    })
    expect(plan.buildFrontend).toBe(true)
  })

  it('builds the frontend when INIT_CWD is unset', () => {
    const plan = planPrepare({ initCwd: null, packageDir: PKG, npmCommand: undefined })
    expect(plan.buildFrontend).toBe(true)
  })

  // The regression this module exists for. `npm publish` is run from the
  // package root, so INIT_CWD === packageDir and the old INIT_CWD-only
  // discriminator concluded "local dev self-install" and skipped the Vite
  // build — publishing a tarball with zero frontend assets, i.e. an installed
  // `vibedocs serve` with no SPA to serve. npm does not re-run `prepare` when
  // installing from the registry, so there is no later chance to recover.
  it.each(['publish', 'pack'])(
    'builds the frontend during `npm %s` even from the package root',
    (npmCommand) => {
      const plan = planPrepare({ initCwd: PKG, packageDir: PKG, npmCommand })
      expect(plan.buildFrontend).toBe(true)
      expect(plan.reason).toContain(npmCommand)
    },
  )
})

// npm re-exports every resolved config value as an `npm_config_*` env var, and
// a child `npm` reads those back in as config. For most settings that is the
// point (registry, proxy, loglevel should all propagate). For `--dry-run` it is
// a bug: it turns the nested `cd frontend && npm install` inside `npm run build`
// into a no-op that still PRINTS "added N packages", after which `vite build`
// dies on `Cannot find package '@vitejs/plugin-react'` — a failure that reads
// exactly like a broken frontend/vite.config.ts. It made `npm publish --dry-run`
// unusable as a release pre-flight on this package.
describe('envForChildNpm — what a child npm may inherit', () => {
  it('strips npm_config_dry_run so nested installs are real', () => {
    const env = envForChildNpm({ npm_config_dry_run: 'true', PATH: '/usr/bin' })
    expect(env.npm_config_dry_run).toBeUndefined()
  })

  it('leaves every other npm_config_* setting inherited', () => {
    const env = envForChildNpm({
      npm_config_dry_run: 'true',
      npm_config_registry: 'https://registry.npmjs.org/',
      npm_config_loglevel: 'warn',
    })
    expect(env.npm_config_registry).toBe('https://registry.npmjs.org/')
    expect(env.npm_config_loglevel).toBe('warn')
  })

  it('is a no-op when npm_config_dry_run is absent', () => {
    expect(envForChildNpm({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' })
  })

  it('does not mutate the env it was given', () => {
    const original = { npm_config_dry_run: 'true' }
    envForChildNpm(original)
    expect(original.npm_config_dry_run).toBe('true')
  })
})
