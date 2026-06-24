// Registers the service worker — PRODUCTION BUILDS ONLY.
//
// `import.meta.env.PROD` is statically `false` under `npm run dev` (Vite dev
// server), so this whole body is dead-code-eliminated from the dev bundle and
// the SW is NEVER active in development. That keeps the live-reload WebSocket
// and HMR untouched (acceptance criterion: "Service worker is inert in dev").
//
// In a production build (`vite build`), the SW file is emitted to dist/sw.js by
// the build plugin in vite.config.ts.

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // Registration failure is non-fatal — the app still works online.
      console.warn('[vibedocs] service worker registration failed:', err)
    })
  })
}
