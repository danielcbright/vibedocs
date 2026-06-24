import { describe, it, expect } from 'vitest'
import {
  renderThemeStyleTag,
  themeTokensToCss,
  SHADCN_ALIAS_MAP,
} from '../src/cli/theme.js'

describe('themeTokensToCss — token record → scoped CSS (slice #51)', () => {
  it('emits each token as a CSS custom property inside the .vd-site-preview scope', () => {
    const css = themeTokensToCss({
      '--vd-site-primary': '#39ff14',
      '--vd-site-background': '#0a0e0a',
    })

    expect(css).toContain('.vd-site-preview {')
    expect(css).toContain('--vd-site-primary: #39ff14;')
    expect(css).toContain('--vd-site-background: #0a0e0a;')
    expect(css.trimEnd().endsWith('}')).toBe(true)
  })

  it('aliases shadcn vars to the matching site token when one is present', () => {
    // The config declares a `--primary` token; the alias map wires
    // `--color-primary` (the shadcn consumer var) to it inside the scope.
    const css = themeTokensToCss({ '--primary': '#39ff14' })

    expect(css).toContain('--primary: #39ff14;')
    expect(css).toContain(`${SHADCN_ALIAS_MAP['--primary']}: var(--primary);`)
  })

  it('only aliases shadcn vars whose source token is actually declared', () => {
    const css = themeTokensToCss({ '--primary': '#39ff14' })

    // No --background token was declared, so no --color-background alias.
    expect(css).not.toContain('--color-background')
  })

  it('returns an empty string for an empty token record', () => {
    expect(themeTokensToCss({})).toBe('')
  })

  it('skips tokens with invalid custom-property names', () => {
    const css = themeTokensToCss({
      '--ok': 'red',
      'no-leading-dashes': 'blue',
      '--bad}injection': 'green',
    })

    expect(css).toContain('--ok: red;')
    expect(css).not.toContain('no-leading-dashes')
    expect(css).not.toContain('--bad}injection')
  })

  it('sanitizes token values to prevent CSS injection (no braces, semicolons mid-value, or angle brackets)', () => {
    const css = themeTokensToCss({
      '--evil': 'red; } body { display: none } </style><script>alert(1)</script>',
    })

    // The dangerous structural characters must not survive into the output.
    expect(css).not.toContain('</style>')
    expect(css).not.toContain('<script>')
    expect(css).not.toContain('body { display: none }')
    // No stray closing brace from the value can break out of the rule.
    const ruleBody = css.slice(css.indexOf('{') + 1, css.lastIndexOf('}'))
    expect(ruleBody).not.toContain('}')
  })

  it('drops a token entirely when its value is empty after sanitizing', () => {
    const css = themeTokensToCss({ '--empty': '{};<>' })
    expect(css).not.toContain('--empty')
  })
})

describe('renderThemeStyleTag — <style> wrapper', () => {
  it('wraps the generated CSS in a <style> tag', () => {
    const tag = renderThemeStyleTag({ '--primary': '#39ff14' })
    expect(tag).toMatch(/^<style[^>]*>/)
    expect(tag).toContain('</style>')
    expect(tag).toContain('--primary: #39ff14;')
  })

  it('returns an empty string when there are no usable tokens', () => {
    expect(renderThemeStyleTag({})).toBe('')
    expect(renderThemeStyleTag(undefined)).toBe('')
  })
})
