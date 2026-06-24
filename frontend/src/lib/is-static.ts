/**
 * Live vs. static-build discriminator.
 *
 * Static builds (`vibedocs build`) inject `window.__VIBEDOCS_STATIC = true` into
 * the generated page; the live SPA never sets it. UI that only makes sense in
 * the live workspace (e.g. the project switcher) gates on this.
 *
 * Strict `=== true` so any stray truthy value can't accidentally flip a live
 * page into static mode.
 */
declare global {
  interface Window {
    __VIBEDOCS_STATIC?: boolean
  }
}

export function isStaticBuild(): boolean {
  return typeof window !== "undefined" && window.__VIBEDOCS_STATIC === true
}
