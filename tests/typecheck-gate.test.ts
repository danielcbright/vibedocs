import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

/**
 * The frontend typecheck gate, pinned structurally (#190).
 *
 * The bug this guards is not "the frontend has type errors" — it is a gate that
 * looks present and checks nothing. Three separate things all read like a
 * frontend typecheck and none is one:
 *
 * - `tsc --noEmit` inside `frontend/`, because `frontend/tsconfig.json` is
 *   solution-style (`files: []` + project references), so it checks zero files
 *   and exits 0.
 * - `vite build`, because esbuild strips types without reading them.
 * - `vitest run`, for the same reason.
 *
 * So the frontend went unchecked with 8 standing errors, and the exhaustiveness
 * guarantee `src/shared/ws-messages.ts` documents — a new WS variant must break
 * every unhandled call-site — was unenforced, since a compile error is only a
 * guarantee if something compiles.
 *
 * A unit test cannot prove tsc works. It can prove the gate is still wired into
 * the three places that would silently drop it.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf-8')
const scriptsOf = (rel: string) => JSON.parse(read(rel)).scripts as Record<string, string>

describe('frontend typecheck gate (#190)', () => {
  it('runs tsc -b, not --noEmit, because --noEmit checks nothing here', () => {
    const script = scriptsOf('frontend/package.json').typecheck
    expect(script, 'frontend needs its own typecheck script').toBeTruthy()
    expect(script).toContain('tsc -b')
    // The trap, spelled out: solution-style config + --noEmit = a green no-op.
    expect(script).not.toContain('--noEmit')
  })

  it('is reachable from the root, so the "am I done?" command covers it', () => {
    const scripts = scriptsOf('package.json')
    expect(scripts['typecheck:frontend']).toBeTruthy()
    expect(scripts.verify).toContain('typecheck:frontend')
  })

  it('runs after the frontend build in verify, which is what installs its deps', () => {
    // Ordering is not cosmetic: `tsc -b` needs frontend/node_modules, and
    // `npm run build` is the step that creates it. Reversed, the gate fails on a
    // fresh clone for a reason that has nothing to do with the code.
    const verify = scriptsOf('package.json').verify
    expect(verify.indexOf('npm run build ')).toBeGreaterThan(-1)
    expect(verify.indexOf('typecheck:frontend')).toBeGreaterThan(verify.indexOf('npm run build '))
  })

  for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    it(`is a step in ${path.basename(workflow)}, after the frontend build`, () => {
      // Both workflows run the gates themselves rather than calling `verify`, so
      // chaining it into `verify` alone would leave CI unguarded.
      const yaml = read(workflow)
      expect(yaml).toContain('npm run typecheck:frontend')
      expect(yaml.indexOf('npm run typecheck:frontend')).toBeGreaterThan(yaml.indexOf('run: npm run build'))
    })
  }
})
