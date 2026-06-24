// Per-site theming for `vibedocs build` (issue #51).
//
// Pure, unit-tested string logic. A project's `.vibedocs.config.ts` declares
// `theme.tokens` — a record of CSS-custom-property name → value. This module
// turns that record into a scoped `<style>` block that `composePageHtml`
// injects into the page `<head>`.
//
// Strategy (spec §5, grill decisions #16/#17): site tokens are emitted inside
// a `.vd-site-preview` scope so they only affect the doc-content area, not the
// vibedocs chrome (the project-switcher widget from slice #58 sits outside the
// scope and stays vibedocs-themed). Inside that scope we ALSO alias the shadcn
// consumer vars (`--color-primary`, etc.) to the matching site token so every
// existing component automatically picks up the site theme.
//
// Token VALUES are author-controlled (config file) but still flow into a
// `<style>` block in the HTML — so they're untrusted from a CSS-injection
// standpoint. `sanitizeTokenValue` strips the structural characters
// (`{ } ; < >`) that could break out of the declaration or the `<style>`
// element. Token NAMES must be valid CSS custom-property identifiers
// (`--[A-Za-z0-9-_]+`) or they're dropped.

/** The scope selector site tokens live under. The doc-content wrapper. */
export const SITE_SCOPE = '.vd-site-preview'

/**
 * Map of site-token name → the shadcn consumer var that should alias to it
 * INSIDE the scope. When the config declares the source token, we emit
 * `<consumer>: var(<source>);` so existing components re-theme automatically.
 * Only aliases whose source token is actually declared are emitted.
 */
export const SHADCN_ALIAS_MAP: Readonly<Record<string, string>> = {
  '--primary': '--color-primary',
  '--primary-foreground': '--color-primary-foreground',
  '--background': '--color-background',
  '--foreground': '--color-foreground',
  '--accent': '--color-accent',
  '--accent-foreground': '--color-accent-foreground',
  '--muted': '--color-muted',
  '--muted-foreground': '--color-muted-foreground',
  '--border': '--color-border',
  '--card': '--color-card',
  '--card-foreground': '--color-card-foreground',
}

/** A valid CSS custom-property identifier: `--` then name chars. */
const CUSTOM_PROP_NAME = /^--[A-Za-z0-9_-]+$/

/**
 * Strip characters that could let a token value break out of its declaration
 * or out of the `<style>` element: `{ } ; < >`. We also collapse the residual
 * whitespace and trim. A value that's empty after this is rejected by the
 * caller (drop the whole declaration).
 */
function sanitizeTokenValue(value: string): string {
  return value.replace(/[{};<>]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Turn a `theme.tokens` record into the scoped CSS body. Returns `''` when no
 * token survives validation/sanitizing (caller then emits no `<style>` tag).
 *
 * Output shape:
 *
 *   .vd-site-preview {
 *     --primary: #39ff14;
 *     --color-primary: var(--primary);
 *   }
 */
export function themeTokensToCss(tokens: Record<string, string>): string {
  const declarations: string[] = []
  const aliases: string[] = []

  for (const [rawName, rawValue] of Object.entries(tokens)) {
    if (!CUSTOM_PROP_NAME.test(rawName)) continue
    if (typeof rawValue !== 'string') continue
    const value = sanitizeTokenValue(rawValue)
    if (value === '') continue
    declarations.push(`  ${rawName}: ${value};`)
    const alias = SHADCN_ALIAS_MAP[rawName]
    if (alias) aliases.push(`  ${alias}: var(${rawName});`)
  }

  if (declarations.length === 0) return ''

  const body = [...declarations, ...aliases].join('\n')
  return `${SITE_SCOPE} {\n${body}\n}`
}

/**
 * Wrap {@link themeTokensToCss} output in a `<style>` element ready to inject
 * into `<head>`. Returns `''` when there's nothing to emit so the template can
 * skip the tag entirely (no-config pages get no style block).
 */
export function renderThemeStyleTag(
  tokens: Record<string, string> | undefined,
): string {
  if (!tokens) return ''
  const css = themeTokensToCss(tokens)
  if (css === '') return ''
  return `<style data-vd-theme>\n${css}\n</style>`
}
