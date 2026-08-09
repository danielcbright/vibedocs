import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs build script, no type declarations by design.
import { planPrepare } from '../scripts/prepare-plan.mjs'

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
